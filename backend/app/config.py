from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    transmission_url: str = "http://127.0.0.1:9091/transmission/rpc"
    transmission_username: str = ""
    transmission_password: str = ""
    # Both processes must see the same absolute download paths.
    download_dir: Path = Path("../data/downloads")
    frontend_dir: Path = Path("../frontend/dist")
    poll_interval: float = Field(default=2.0, ge=0.5, le=30)
    stream_wait_seconds: float = Field(default=30.0, ge=0, le=120)
    stream_chunk_bytes: int = Field(default=256 * 1024, ge=1024, le=4 * 1024 * 1024)
    max_torrent_bytes: int = Field(default=8 * 1024 * 1024, ge=1024)
    # Optional single-user login. Use TLS when serving beyond loopback.
    app_password: str = ""
    session_secret: str = ""
    secure_cookies: bool = False
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "testserver"]
    allowed_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
