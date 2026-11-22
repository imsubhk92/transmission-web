#!/usr/bin/env python3
"""Create an original local test video and matching torrent. No public swarm is used.

Requires ffmpeg. Upload data/fixtures/welcome.torrent in Streamline, or pass --register
to verify and register the existing file through the running FastAPI server.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def bencode(value):
    if isinstance(value, int):
        return b"i" + str(value).encode() + b"e"
    if isinstance(value, str):
        value = value.encode()
    if isinstance(value, bytes):
        return str(len(value)).encode() + b":" + value
    if isinstance(value, list):
        return b"l" + b"".join(bencode(item) for item in value) + b"e"
    if isinstance(value, dict):
        return b"d" + b"".join(bencode(key) + bencode(value[key]) for key in sorted(value)) + b"e"
    raise TypeError(type(value))


def torrent_for(path: Path, *, webseed: str | None = None) -> tuple[bytes, str]:
    piece_length = 64 * 1024
    content = path.read_bytes()
    info = {
        b"name": path.name.encode(),
        b"length": len(content),
        b"piece length": piece_length,
        b"pieces": b"".join(
            hashlib.sha1(content[i : i + piece_length]).digest()
            for i in range(0, len(content), piece_length)
        ),
    }
    meta = {
        b"info": info,
        b"comment": b"Original Streamline local verification sample",
        b"created by": b"Streamline",
    }
    if webseed:
        meta[b"url-list"] = webseed.encode()
    return bencode(meta), hashlib.sha1(bencode(info)).hexdigest()


def request(base, path, body=None):
    req = urllib.request.Request(
        base + "/api" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--register", action="store_true")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--download-dir", type=Path, default=ROOT / "data/downloads")
    args = parser.parse_args()
    if not shutil.which("ffmpeg"):
        parser.error("ffmpeg is required to generate the sample")
    fixtures = ROOT / "data/fixtures"
    fixtures.mkdir(parents=True, exist_ok=True)
    args.download_dir.mkdir(parents=True, exist_ok=True)
    video = fixtures / "Welcome to Streamline.mp4"
    if not video.exists():
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=960x540:rate=24",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=44100",
                "-t",
                "12",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "24",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                "-movflags",
                "+faststart",
                str(video),
            ],
            check=True,
        )
    shutil.copyfile(video, args.download_dir / video.name)
    meta, info_hash = torrent_for(video)
    (fixtures / "welcome.torrent").write_bytes(meta)
    print(f"Created {video} ({video.stat().st_size:,} bytes)")
    print(f"Upload {fixtures / 'welcome.torrent'} to Streamline.")
    if args.register:
        boundary = "streamline-sample-boundary"
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="welcome.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n'.encode()
            + meta
            + f"\r\n--{boundary}--\r\n".encode()
        )
        req = urllib.request.Request(
            args.base_url + "/api/torrents/upload?paused=true",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        with urllib.request.urlopen(req) as response:
            result = json.load(response)
        if "torrent_duplicate" not in result:
            request(args.base_url, f"/torrents/{info_hash}/action", {"action": "verify"})
        for _ in range(40):
            state = request(args.base_url, f"/torrents/{info_hash}")
            if state["percent_done"] >= 1:
                break
            time.sleep(0.5)
        else:
            raise SystemExit(
                "The daemon did not verify the sample. Check the shared download directory."
            )
        request(args.base_url, f"/torrents/{info_hash}/action", {"action": "start"})
        print(f"Registered and verified sample: {info_hash}")


if __name__ == "__main__":
    main()
