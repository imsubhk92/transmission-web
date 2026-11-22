from typing import Literal
from urllib.parse import parse_qs, urlparse

from pydantic import BaseModel, Field, field_validator


class AddTorrent(BaseModel):
    magnet: str = Field(min_length=20, max_length=16384)
    paused: bool = False

    @field_validator("magnet")
    @classmethod
    def magnet_only(cls, value: str) -> str:
        value = value.strip()
        parsed = urlparse(value)
        topics = parse_qs(parsed.query).get("xt", [])
        if parsed.scheme != "magnet" or not any(t.startswith("urn:btih:") for t in topics):
            raise ValueError("Paste a BitTorrent magnet link, or upload a .torrent file.")
        # Arbitrary URLs and local paths are deliberately not forwarded to RPC.
        return value


class TorrentAction(BaseModel):
    action: Literal["start", "pause", "verify", "reannounce"]


class FileSelection(BaseModel):
    wanted: bool | None = None
    priority: Literal[-1, 0, 1] | None = None


class SessionUpdate(BaseModel):
    speed_limit_down: int | None = Field(default=None, ge=0, le=1000000)
    speed_limit_down_enabled: bool | None = None
    speed_limit_up: int | None = Field(default=None, ge=0, le=1000000)
    speed_limit_up_enabled: bool | None = None
    download_queue_size: int | None = Field(default=None, ge=1, le=100)
    download_queue_enabled: bool | None = None


class Login(BaseModel):
    password: str = Field(max_length=1024)
