import asyncio
from pathlib import Path

from fastapi import HTTPException

from app.rpc import TransmissionRPC

SUMMARY_FIELDS = [
    "id",
    "hash_string",
    "name",
    "status",
    "total_size",
    "size_when_done",
    "percent_done",
    "rate_download",
    "rate_upload",
    "eta",
    "peers_connected",
    "upload_ratio",
    "added_date",
    "error",
    "error_string",
    "metadata_percent_complete",
    "downloaded_ever",
    "uploaded_ever",
    "files",
    "file_stats",
    "labels",
    "queue_position",
]
DETAIL_FIELDS = SUMMARY_FIELDS + [
    "download_dir",
    "pieces",
    "piece_count",
    "piece_size",
    "tracker_stats",
    "comment",
    "creator",
]
SESSION_FIELDS = [
    "version",
    "download_dir",
    "speed_limit_down",
    "speed_limit_down_enabled",
    "speed_limit_up",
    "speed_limit_up_enabled",
    "download_queue_size",
    "download_queue_enabled",
]
PLAYABLE = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
}
VIDEO = {".mp4", ".m4v", ".webm", ".ogv", ".mkv", ".avi", ".mov", ".ts"}


def public_torrent(torrent: dict, *, detail: bool = False) -> dict:
    result = {key: value for key, value in torrent.items() if key not in {"pieces", "download_dir"}}
    offset = 0
    files = []
    for index, file in enumerate(torrent.get("files", [])):
        extension = Path(file["name"]).suffix.lower()
        stats = torrent.get("file_stats") or []
        files.append(
            {
                **file,
                "index": index,
                "offset": offset,
                "playable": extension in PLAYABLE,
                "media_type": "video"
                if extension in VIDEO
                else "audio"
                if extension in PLAYABLE
                else "file",
                "mime_type": PLAYABLE.get(extension, "application/octet-stream"),
                "wanted": stats[index].get("wanted", True) if index < len(stats) else True,
                "priority": stats[index].get("priority", 0) if index < len(stats) else 0,
            }
        )
        offset += file["length"]
    result["files"] = files
    result.pop("file_stats", None)
    if not detail:
        result.pop("tracker_stats", None)
    return result


class TorrentService:
    def __init__(self, rpc: TransmissionRPC, download_dir: Path | None = None):
        self.rpc = rpc
        self.download_dir = download_dir

    async def get(self, torrent_id: str, *, pieces: bool = False) -> dict:
        # Hashes remain stable across daemon restarts; numeric IDs are only an API convenience.
        if not (
            (torrent_id.isascii() and torrent_id.isdecimal() and len(torrent_id) <= 10)
            or (len(torrent_id) == 40 and all(c in "0123456789abcdefABCDEF" for c in torrent_id))
        ):
            raise HTTPException(422, "Invalid torrent ID.")
        fields = DETAIL_FIELDS if pieces else SUMMARY_FIELDS
        result = await self.rpc.call(
            "torrent_get",
            {"ids": [int(torrent_id) if torrent_id.isdecimal() else torrent_id], "fields": fields},
        )
        if not result.get("torrents"):
            raise HTTPException(404, "Torrent not found.")
        return result["torrents"][0]

    async def snapshot(self) -> dict:
        torrents, stats, session = await asyncio.gather(
            self.rpc.call("torrent_get", {"fields": SUMMARY_FIELDS}),
            self.rpc.call("session_stats"),
            self.rpc.call("session_get", {"fields": SESSION_FIELDS}),
        )
        if self.download_dir is not None:
            session["download_dir"] = str(self.download_dir)
        return {
            "connected": True,
            "torrents": [public_torrent(t) for t in torrents.get("torrents", [])],
            "stats": stats,
            "session": session,
            "sequential_supported": bool(self.rpc.modern),
        }

    @staticmethod
    def file(torrent: dict, index: int) -> tuple[dict, int]:
        files = torrent.get("files", [])
        if index < 0 or index >= len(files):
            raise HTTPException(404, "File not found. Metadata may still be downloading.")
        return files[index], sum(f["length"] for f in files[:index])
