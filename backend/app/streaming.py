"""Range streaming guarded by Transmission's verified-piece bitfield.

Sparse files can have their full size before their contents exist. File size and
aggregate bytesCompleted are never sufficient evidence that a range is readable.
"""

import asyncio
import base64
import binascii
import re
import time
from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from app.config import Settings
from app.service import PLAYABLE, TorrentService


def parse_range(header: str | None, size: int) -> tuple[int, int, bool]:
    if size <= 0:
        raise HTTPException(416, "Empty file.", headers={"Content-Range": f"bytes */{size}"})
    if not header:
        return 0, size - 1, False
    match = re.fullmatch(r"bytes=(\d{0,20})-(\d{0,20})", header.strip())
    if not match or not any(match.groups()):
        raise HTTPException(
            416, "Use one valid byte range.", headers={"Content-Range": f"bytes */{size}"}
        )
    left, right = match.groups()
    if not left:
        count = int(right)
        start, end = max(0, size - count), size - 1
        if count == 0:
            start = size
    else:
        start, end = int(left), min(int(right), size - 1) if right else size - 1
    if start >= size or end < start:
        raise HTTPException(
            416, "Range is outside the file.", headers={"Content-Range": f"bytes */{size}"}
        )
    return start, end, True


def piece_available(bits: bytes, piece: int) -> bool:
    return 0 <= piece // 8 < len(bits) and bool(bits[piece // 8] & (0x80 >> (piece % 8)))


def verified_end(torrent: dict, offset: int, start: int, end: int) -> int:
    """Last contiguous verified byte, in file coordinates, or start-1."""
    piece_size = torrent.get("piece_size", 0)
    if piece_size <= 0:
        return start - 1
    try:
        bits = base64.b64decode(torrent.get("pieces", ""), validate=True)
    except (ValueError, binascii.Error):
        return start - 1
    first = (offset + start) // piece_size
    last = (offset + end) // piece_size
    piece = first
    while piece <= last and piece_available(bits, piece):
        piece += 1
    return min(end, piece * piece_size - offset - 1)


def safe_path(settings: Settings, torrent: dict, file: dict) -> Path:
    root = settings.download_dir.resolve()
    directory = Path(torrent["download_dir"]).resolve()
    candidate = (directory / file["name"]).resolve()
    # Resolve symlinks as well as '..'; neither daemon metadata nor client input
    # may turn this endpoint into a general-purpose local file server.
    if not directory.is_relative_to(root) or not candidate.is_relative_to(root):
        raise HTTPException(403, "This file is outside the configured download directory.")
    for path in (candidate, Path(str(candidate) + ".part")):
        if path.resolve().is_relative_to(root) and path.is_file():
            return path
    raise HTTPException(409, "File is not on disk yet. Waiting for torrent metadata or pieces.")


async def prepare_stream(service: TorrentService, torrent_id: str, file_index: int) -> dict:
    torrent = await service.get(torrent_id, pieces=True)
    file, offset = service.file(torrent, file_index)
    if Path(file["name"]).suffix.lower() not in PLAYABLE:
        raise HTTPException(
            415, "This format needs an external player. Use an MP4, WebM, or supported audio file."
        )
    args = {
        "ids": [torrent["hash_string"]],
        "files_wanted": [file_index],
        "priority_high": [file_index],
    }
    if service.rpc.modern:
        args.update(
            sequential_download=True,
            sequential_download_from_piece=offset // max(1, torrent.get("piece_size", 1)),
        )
    await service.rpc.call("torrent_set", args)
    await service.rpc.call("torrent_start", {"ids": [torrent["hash_string"]]})
    return {
        "url": f"/api/torrents/{torrent['hash_string']}/files/{file_index}/stream",
        "sequential": bool(service.rpc.modern),
        "message": "Sequential download enabled. Playback starts when the requested pieces arrive."
        if service.rpc.modern
        else (
            "File prioritized. This daemon does not support sequential download; "
            "playback may need the completed file."
        ),
    }


async def stream_file(
    request: Request, service: TorrentService, settings: Settings, torrent_id: str, file_index: int
):
    torrent = await service.get(torrent_id, pieces=True)
    file, offset = service.file(torrent, file_index)
    size = file["length"]
    start, end, partial = parse_range(request.headers.get("range"), size)
    mime = PLAYABLE.get(Path(file["name"]).suffix.lower(), "application/octet-stream")
    download = request.query_params.get("download") == "1"
    if mime == "application/octet-stream" and not download:
        raise HTTPException(415, "Use the download option for this file type.")
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "attachment" if download else "inline",
    }
    if partial:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    status = 206 if partial else 200
    if request.method == "HEAD":
        return Response(status_code=status, headers=headers, media_type=mime)

    async def wait_ready(position: int, current: dict) -> tuple[int, dict]:
        deadline = time.monotonic() + settings.stream_wait_seconds
        while True:
            available = verified_end(current, offset, position, end)
            if available >= position:
                return available, current
            if await request.is_disconnected():
                raise asyncio.CancelledError
            if time.monotonic() >= deadline:
                raise HTTPException(
                    503,
                    "Buffering: the requested pieces have not downloaded yet.",
                    headers={"Retry-After": "3"},
                )
            await asyncio.sleep(0.5)
            current = await service.get(torrent_id, pieces=True)

    available, torrent = await wait_ready(start, torrent)
    # Fail before committing response headers if this is a remote daemon without
    # a shared mount, or a not-yet-created file.
    try:
        path = safe_path(settings, torrent, file)
    except HTTPException as exc:
        if exc.status_code != 409:
            raise
        # An externally managed daemon may keep incomplete files in a separate
        # folder. It must still be inside the configured shared root.
        session = await service.rpc.call(
            "session_get", {"fields": ["incomplete_dir", "incomplete_dir_enabled"]}
        )
        if not session.get("incomplete_dir_enabled") or not session.get("incomplete_dir"):
            raise exc
        path = safe_path(settings, {**torrent, "download_dir": session["incomplete_dir"]}, file)
    if path.stat().st_size <= start:
        raise HTTPException(409, "Verified data has not been flushed to the shared disk yet.")

    async def chunks():
        position = start
        current = torrent
        ready = available
        # An open descriptor survives Transmission renaming .part after completion.
        with path.open("rb") as handle:
            while position <= end:
                if await request.is_disconnected():
                    return
                if position > ready:
                    ready, current = await wait_ready(
                        position, await service.get(torrent_id, pieces=True)
                    )
                count = min(settings.stream_chunk_bytes, ready - position + 1)
                handle.seek(position)
                data = await asyncio.to_thread(handle.read, count)
                if not data:
                    raise OSError("Verified torrent data is unavailable on the shared disk.")
                position += len(data)
                yield data

    return StreamingResponse(chunks(), status_code=status, headers=headers, media_type=mime)
