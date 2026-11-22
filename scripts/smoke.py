#!/usr/bin/env python3
"""Real-daemon HTTP checks; uses only our locally generated fixture.

Run create_sample.py --register first. This script checks a byte-exact range,
suffix range, HEAD, invalid ranges, live SSE, pause/resume, and sequential mode.
With --transfer, it additionally serves a throttled local web seed to verify an
actual incomplete download and piece-guarded streaming before completion.
"""

import argparse
import json
import secrets
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from create_sample import ROOT, torrent_for


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--transfer", action="store_true")
    parser.add_argument("--webseed-host", default="host.docker.internal")
    parser.add_argument("--webseed-port", type=int, default=8766)
    args = parser.parse_args()
    base = args.base_url + "/api"

    def call(path, data=None, method=None, headers=None):
        req = urllib.request.Request(
            base + path,
            data=json.dumps(data).encode() if data is not None else None,
            method=method,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        return urllib.request.urlopen(req, timeout=40)

    def json_call(path, data=None, method=None):
        with call(path, data, method) as response:
            return json.load(response)

    video = ROOT / "data/fixtures/Welcome to Streamline.mp4"
    source = video.read_bytes()
    _, info_hash = torrent_for(video)
    torrent = json_call(f"/torrents/{info_hash}")
    assert torrent["percent_done"] == 1, "Register the sample first"
    url = f"/torrents/{info_hash}/files/0/stream"
    with call(url, headers={"Range": "bytes=123-4567"}) as response:
        assert response.status == 206
        assert response.read() == source[123:4568]
        assert response.headers["Content-Range"] == f"bytes 123-4567/{len(source)}"
    with call(url, headers={"Range": "bytes=-128"}) as response:
        assert response.read() == source[-128:]
    with call(url, method="HEAD") as response:
        assert int(response.headers["Content-Length"]) == len(source)
        assert response.read() == b""
    try:
        call(url, headers={"Range": f"bytes={len(source)}-"})
        raise AssertionError("Invalid range accepted")
    except urllib.error.HTTPError as exc:
        assert exc.code == 416
    json_call(f"/torrents/{info_hash}/action", {"action": "pause"})
    for _ in range(20):
        if json_call(f"/torrents/{info_hash}")["status"] == 0:
            break
        time.sleep(0.1)
    else:
        raise AssertionError("The daemon did not pause the sample")
    prepared = json_call(f"/torrents/{info_hash}/files/0/prepare", {}, "POST")
    assert prepared["sequential"]
    with call("/events") as response:
        lines = [response.readline().decode() for _ in range(3)]
        assert lines[1] == "event: state\n"
        assert "torrents" in json.loads(lines[2].removeprefix("data: "))
    print("PASS: real-daemon range, suffix, HEAD, 416, pause/resume, sequential prepare, SSE")

    if not args.transfer:
        return

    # Keep a valid fast-start MP4, but make it larger than a webseed request batch.
    # Small files can be fetched as a single response and verified only at EOF.
    padding = bytes(24 * 1024 * 1024)
    source += struct.pack(">I4s", len(padding) + 8, b"free") + padding
    transfer = video.with_name(f"Progressive stream test {secrets.token_hex(4)}.mp4")
    transfer.write_bytes(source)

    # Each response is throttled. Seeking and restarting the webseed remains supported.
    class WebSeed(BaseHTTPRequestHandler):
        def do_GET(self):
            if urllib.parse.unquote(self.path).split("?")[0] != "/" + transfer.name:
                self.send_error(404)
                return
            start, end = 0, len(source) - 1
            header = self.headers.get("Range", "")
            print(f"Local webseed request: {header or 'entire file'}")
            if header.startswith("bytes="):
                left, right = header[6:].split("-", 1)
                start, end = int(left), min(int(right), end) if right else end
            self.send_response(206 if header else 200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            if header:
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(source)}")
            self.end_headers()
            try:
                for position in range(start, end + 1, 16384):
                    self.wfile.write(source[position : min(end + 1, position + 16384)])
                    self.wfile.flush()
                    time.sleep(0.02)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *unused):
            pass

    server = ThreadingHTTPServer(("0.0.0.0", args.webseed_port), WebSeed)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    seed_url = f"http://{args.webseed_host}:{args.webseed_port}/" + urllib.parse.quote(
        transfer.name
    )
    meta, transfer_hash = torrent_for(transfer, webseed=seed_url)
    boundary = "streamline-transfer"
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="transfer.torrent"\r\n\r\n'.encode()
        + meta
        + f"\r\n--{boundary}--\r\n".encode()
    )
    req = urllib.request.Request(
        base + "/torrents/upload",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req) as response:
            result = json.load(response)
        assert "torrent_duplicate" not in result, (
            "Previous transfer test exists; remove it before retrying"
        )
        json_call(f"/torrents/{transfer_hash}/files/0/prepare", {}, "POST")
        print("Checking a fresh local webseed transfer…")
        deadline = time.monotonic() + 90
        last_progress = None
        while time.monotonic() < deadline:
            detail = json_call(f"/torrents/{transfer_hash}")
            progress = detail["percent_done"]
            if progress != last_progress:
                print(
                    f"Transfer progress: {progress:.1%}; {detail['files'][0]['bytes_completed']} verified bytes"
                )
                last_progress = progress
            if detail.get("error"):
                raise AssertionError(detail.get("error_string", "Transmission transfer error"))
            if 0 < detail["percent_done"] < 1:
                break
            time.sleep(0.25)
        else:
            raise AssertionError(
                f"The local webseed transfer did not start: {detail.get('error_string') or detail['status']}"
            )
        stream = f"/torrents/{transfer_hash}/files/0/stream"
        with call(stream, headers={"Range": "bytes=0-32767"}) as response:
            assert response.status == 206 and response.read() == source[:32768]
        assert json_call(f"/torrents/{transfer_hash}")["percent_done"] < 1
        print(
            "PASS: byte-exact playback range served during an actual incomplete Transmission download"
        )
        while time.monotonic() < deadline:
            if json_call(f"/torrents/{transfer_hash}")["percent_done"] == 1:
                break
            time.sleep(0.5)
        else:
            raise AssertionError("Transfer did not finish within 90 seconds")
        with call(stream, headers={"Range": "bytes=-128"}) as response:
            assert response.read() == source[-128:]
        print("PASS: locally seeded download completed and its tail bytes match")
    finally:
        # Only remove the disposable torrent created by this test; preserve downloaded data.
        if "result" in locals() and "torrent_duplicate" not in result:
            json_call(f"/torrents/{transfer_hash}", method="DELETE")
        server.shutdown()


if __name__ == "__main__":
    main()
