from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import HASH


def test_state_and_detail_do_not_expose_piece_bitfield(client):
    state = client.get("/api/state").json()
    assert state["connected"]
    assert state["torrents"][0]["files"][0]["playable"]
    assert "pieces" not in state["torrents"][0]
    assert "download_dir" not in state["torrents"][0]
    assert "pieces" not in client.get(f"/api/torrents/{HASH}").json()


def test_magnet_and_upload_are_forwarded_to_configured_directory(client, setup):
    config, rpc = setup
    assert (
        client.post("/api/torrents", json={"magnet": f"magnet:?xt=urn:btih:{HASH}"}).status_code
        == 201
    )
    args = [args for method, args in rpc.calls if method == "torrent_add"][-1]
    assert args["download_dir"] == str(config.download_dir.resolve())
    assert (
        client.post(
            "/api/torrents/upload?paused=true", files={"file": ("test.torrent", b"d4:infodee")}
        ).status_code
        == 201
    )
    args = [args for method, args in rpc.calls if method == "torrent_add"][-1]
    assert args["paused"] is True
    assert "metainfo" in args


def test_add_does_not_accept_server_paths_or_arbitrary_urls(client):
    for value in (
        "file:///etc/passwd",
        "https://example.com/file.torrent",
        "/tmp/local.torrent",
        "magnet:?dn=missing-hash",
    ):
        assert client.post("/api/torrents", json={"magnet": value}).status_code == 422
    assert client.post("/api/torrents/upload", files={"file": ("no.txt", b"x")}).status_code == 422


def test_controls_target_one_stable_hash(client, setup):
    _, rpc = setup
    assert client.post(f"/api/torrents/{HASH}/action", json={"action": "pause"}).status_code == 200
    assert ("torrent_stop", {"ids": [HASH]}) in rpc.calls
    assert (
        client.patch(
            f"/api/torrents/{HASH}/files/0", json={"priority": 1, "wanted": False}
        ).status_code
        == 200
    )
    args = [args for method, args in rpc.calls if method == "torrent_set"][-1]
    assert args == {"ids": [HASH], "files_unwanted": [0], "priority_high": [0]}
    assert client.patch(f"/api/torrents/{HASH}/files/99", json={"priority": 1}).status_code == 404
    assert client.post("/api/torrents/999/action", json={"action": "pause"}).status_code == 404
    assert client.post("/api/torrents/all/action", json={"action": "pause"}).status_code == 422


def test_removing_preserves_data_by_default(client, setup):
    _, rpc = setup
    assert client.delete(f"/api/torrents/{HASH}").status_code == 200
    assert ("torrent_remove", {"ids": [HASH], "delete_local_data": False}) in rpc.calls


def test_invalid_settings_are_rejected(client):
    assert client.patch("/api/session", json={"speed_limit_down": -1}).status_code == 422
    assert client.patch("/api/session", json={"download_queue_size": 0}).status_code == 422


def test_authentication_and_origin_protection(setup):
    config, rpc = setup
    config.app_password = "correct horse"
    with TestClient(create_app(config, rpc)) as client:
        assert client.get("/api/state").status_code == 401
        assert client.get(f"/api/torrents/{HASH}/files/0/stream").status_code == 401
        assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
        response = client.post("/api/auth/login", json={"password": "correct horse"})
        assert response.status_code == 200
        assert "httponly" in response.headers["set-cookie"].lower()
        assert client.get("/api/state").status_code == 200
        assert (
            client.post(
                f"/api/torrents/{HASH}/action",
                json={"action": "pause"},
                headers={"Origin": "https://attacker.example"},
            ).status_code
            == 403
        )
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/state").status_code == 401


def test_login_rate_limit(setup):
    config, rpc = setup
    config.app_password = "correct"
    with TestClient(create_app(config, rpc)) as client:
        for _ in range(5):
            assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
        assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 429


def test_chunked_body_size_limit(setup):
    config, rpc = setup
    config.max_torrent_bytes = 1024
    with TestClient(create_app(config, rpc)) as client:

        def chunks():
            yield b"a" * 40000
            yield b"b" * 40000

        response = client.post(
            "/api/torrents/upload",
            content=chunks(),
            headers={"content-type": "application/octet-stream"},
        )
        assert response.status_code == 413


def test_unknown_api_route_is_not_a_successful_spa_response(client):
    assert client.get("/api/does-not-exist").status_code == 404


def test_numeric_ids_cannot_overflow_integer_parsing(client):
    assert client.get("/api/torrents/" + "9" * 5000).status_code == 422
