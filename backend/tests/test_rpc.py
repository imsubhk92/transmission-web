import httpx
import pytest

from app.config import Settings
from app.rpc import RPCError, TransmissionRPC


async def test_modern_protocol_and_session_challenge():
    requests = []

    def handler(request):
        requests.append(request)
        if request.headers.get("x-transmission-session-id") != "nonce":
            return httpx.Response(409, headers={"X-Transmission-Session-Id": "nonce"})
        return httpx.Response(200, json={"jsonrpc": "2.0", "result": {"version": "4.1.4"}, "id": 1})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        rpc = TransmissionRPC(Settings(_env_file=None), http)
        assert await rpc.call("session_get", {"fields": ["version"]}) == {"version": "4.1.4"}
        assert rpc.modern is True
        assert len(requests) == 3
        assert requests[-1].headers["x-transmission-session-id"] == "nonce"


async def test_legacy_protocol_translates_requests_and_nested_responses():
    import json

    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        if body["method"] == "session_get":
            return httpx.Response(
                200, json={"result": "method name not recognized", "arguments": {}}
            )
        return httpx.Response(
            200,
            json={
                "result": "success",
                "arguments": {
                    "torrents": [{"hashString": "abc", "files": [{"bytesCompleted": 8}]}]
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        rpc = TransmissionRPC(Settings(_env_file=None), http)
        result = await rpc.call("torrent_get", {"fields": ["hash_string", "files"], "ids": [1]})
        assert result["torrents"][0] == {"hash_string": "abc", "files": [{"bytes_completed": 8}]}
        assert requests[-1] == {
            "method": "torrent-get",
            "arguments": {"fields": ["hashString", "files"], "ids": [1]},
            "tag": 2,
        }
        await rpc.call("torrent_add", {"download_dir": "/downloads", "priority_high": [0]})
        assert requests[-1]["arguments"] == {"download-dir": "/downloads", "priority-high": [0]}


@pytest.mark.parametrize("status", [401, 403, 500])
async def test_http_errors_are_actionable(status):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(status))
    ) as http:
        rpc = TransmissionRPC(Settings(_env_file=None), http)
        with pytest.raises(RPCError) as caught:
            await rpc.call("session_stats")
        assert caught.value.unavailable


async def test_mutation_is_not_retried_after_transport_failure():
    requests = []

    def handler(request):
        requests.append(request)
        raise httpx.ReadTimeout("Response lost")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        rpc = TransmissionRPC(Settings(_env_file=None), http)
        rpc.modern = True
        with pytest.raises(RPCError):
            await rpc.call("torrent_add", {"filename": "magnet:?xt=urn:btih:abc"})
        assert len(requests) == 1


async def test_rpc_error_does_not_report_success():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, json={"jsonrpc": "2.0", "error": {"code": 5, "message": "invalid torrent"}}
            )
        )
    ) as http:
        rpc = TransmissionRPC(Settings(_env_file=None), http)
        rpc.modern = True
        with pytest.raises(RPCError, match="invalid torrent"):
            await rpc.call("torrent_add")
