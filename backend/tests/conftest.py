import copy

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

HASH = "a" * 40


class FakeRPC:
    modern = True

    def __init__(self, root):
        self.calls = []
        self.session = {"version": "4.1.4", "download_dir": str(root)}
        self.torrent = {
            "id": 1,
            "hash_string": HASH,
            "name": "sample.mp4",
            "status": 6,
            "total_size": 16,
            "size_when_done": 16,
            "percent_done": 1,
            "metadata_percent_complete": 1,
            "rate_download": 0,
            "rate_upload": 0,
            "eta": -1,
            "peers_connected": 0,
            "upload_ratio": 0,
            "error": 0,
            "error_string": "",
            "added_date": 1,
            "downloaded_ever": 16,
            "uploaded_ever": 0,
            "download_dir": str(root),
            "piece_size": 4,
            "piece_count": 4,
            "pieces": "8A==",
            "files": [{"name": "sample.mp4", "length": 16, "bytes_completed": 16}],
            "file_stats": [{"wanted": True, "priority": 0}],
            "labels": [],
        }

    async def call(self, method, args=None):
        self.calls.append((method, args))
        if method == "torrent_get":
            ids = (args or {}).get("ids")
            return {
                "torrents": [copy.deepcopy(self.torrent)] if not ids or ids[0] in (1, HASH) else []
            }
        if method == "session_get":
            return copy.deepcopy(self.session)
        if method == "session_stats":
            return {"download_speed": 0, "upload_speed": 0}
        if method == "torrent_add":
            return {"torrent_added": {"id": 1, "hash_string": HASH, "name": "sample.mp4"}}
        return {}

    async def close(self):
        pass


@pytest.fixture
def setup(tmp_path):
    root = tmp_path / "downloads"
    root.mkdir()
    (root / "sample.mp4").write_bytes(b"0123456789abcdef")
    config = Settings(_env_file=None, download_dir=root, stream_wait_seconds=0)
    rpc = FakeRPC(root)
    return config, rpc


@pytest.fixture
def client(setup):
    config, rpc = setup
    with TestClient(create_app(config, rpc)) as test:
        yield test
