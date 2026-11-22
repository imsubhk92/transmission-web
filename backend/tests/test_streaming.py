import pytest
from fastapi import HTTPException

from app.streaming import parse_range, safe_path, verified_end
from tests.conftest import HASH


@pytest.mark.parametrize(
    "header,expected",
    [
        (None, (0, 15, False)),
        ("bytes=2-5", (2, 5, True)),
        ("bytes=12-", (12, 15, True)),
        ("bytes=-4", (12, 15, True)),
        ("bytes=0-999", (0, 15, True)),
        ("bytes=-999", (0, 15, True)),
    ],
)
def test_ranges(header, expected):
    assert parse_range(header, 16) == expected


@pytest.mark.parametrize(
    "header",
    ["bytes=16-", "bytes=6-2", "bytes=-0", "bytes=0-1,4-5", "items=1-2", "bytes=-", "bytes=wat"],
)
def test_unsatisfiable_ranges(header):
    with pytest.raises(HTTPException) as caught:
        parse_range(header, 16)
    assert caught.value.status_code == 416
    assert caught.value.headers["Content-Range"] == "bytes */16"


def test_sparse_file_readiness_uses_verified_pieces():
    torrent = {"piece_size": 4, "pieces": "oA=="}  # pieces 0 and 2, with a hole between
    assert verified_end(torrent, 0, 0, 15) == 3
    assert verified_end(torrent, 0, 8, 15) == 11
    assert verified_end(torrent, 0, 4, 15) < 4
    # File begins two bytes into piece 0; offsets must not expose the missing piece.
    assert verified_end(torrent, 2, 0, 9) == 1
    assert verified_end({"piece_size": 4, "pieces": "invalid!"}, 0, 0, 9) < 0


def test_range_response_and_suffix_are_byte_exact(client):
    url = f"/api/torrents/{HASH}/files/0/stream"
    response = client.get(url, headers={"Range": "bytes=2-7"})
    assert response.status_code == 206
    assert response.content == b"234567"
    assert response.headers["content-range"] == "bytes 2-7/16"
    assert response.headers["content-length"] == "6"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-type"] == "video/mp4"
    assert client.get(url, headers={"Range": "bytes=-4"}).content == b"cdef"
    assert client.get(url).content == b"0123456789abcdef"
    assert client.head(url).content == b""
    assert client.head(url).headers["content-length"] == "16"


def test_missing_piece_returns_buffering_instead_of_sparse_bytes(client, setup):
    config, rpc = setup
    rpc.torrent["pieces"] = "gA=="  # only first piece is verified, full-size file still exists
    response = client.get(f"/api/torrents/{HASH}/files/0/stream", headers={"Range": "bytes=4-7"})
    assert response.status_code == 503
    assert response.headers["retry-after"] == "3"
    assert "Buffering" in response.json()["detail"]


def test_partial_filename_is_supported(client, setup):
    config, rpc = setup
    path = config.download_dir / "sample.mp4"
    path.rename(str(path) + ".part")
    assert (
        client.get(f"/api/torrents/{HASH}/files/0/stream", headers={"Range": "bytes=0-3"}).content
        == b"0123"
    )


def test_shared_incomplete_directory_is_supported(client, setup):
    config, rpc = setup
    incomplete = config.download_dir / "incomplete"
    incomplete.mkdir()
    (config.download_dir / "sample.mp4").rename(incomplete / "sample.mp4.part")
    rpc.session.update(incomplete_dir=str(incomplete), incomplete_dir_enabled=True)
    response = client.get(f"/api/torrents/{HASH}/files/0/stream", headers={"Range": "bytes=0-3"})
    assert response.status_code == 206
    assert response.content == b"0123"


def test_range_with_oversized_numbers_is_rejected():
    with pytest.raises(HTTPException) as caught:
        parse_range("bytes=" + "9" * 5000 + "-", 16)
    assert caught.value.status_code == 416


def test_path_traversal_and_symlinks_are_rejected(setup, tmp_path):
    config, rpc = setup
    outside = tmp_path / "secret.mp4"
    outside.write_bytes(b"private")
    for name in ("../secret.mp4", str(outside)):
        with pytest.raises(HTTPException) as caught:
            safe_path(config, rpc.torrent, {"name": name})
        assert caught.value.status_code == 403
    (config.download_dir / "link.mp4").symlink_to(outside)
    with pytest.raises(HTTPException) as caught:
        safe_path(config, rpc.torrent, {"name": "link.mp4"})
    assert caught.value.status_code == 403


def test_prepare_enables_sequential_on_capable_daemon(client, setup):
    _, rpc = setup
    response = client.post(f"/api/torrents/{HASH}/files/0/prepare")
    assert response.status_code == 200
    assert response.json()["sequential"]
    mutation = [args for method, args in rpc.calls if method == "torrent_set"][-1]
    assert mutation["sequential_download"] is True
    assert mutation["priority_high"] == [0]


def test_prepare_legacy_only_prioritizes(client, setup):
    _, rpc = setup
    rpc.modern = False
    assert not client.post(f"/api/torrents/{HASH}/files/0/prepare").json()["sequential"]
    mutation = [args for method, args in rpc.calls if method == "torrent_set"][-1]
    assert "sequential_download" not in mutation
