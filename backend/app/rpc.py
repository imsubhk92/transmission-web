"""Small async RPC adapter, supporting both Transmission 4.1+ and 3/4.0.

Protocol negotiation is read-only. Mutations are never retried on transport errors,
since an interrupted response does not mean that the daemon rejected the request.
"""

import asyncio
import re
from typing import Any

import httpx

from app.config import Settings


class RPCError(Exception):
    def __init__(self, message: str, *, unavailable: bool = False):
        self.message = message
        self.unavailable = unavailable
        super().__init__(message)


# Legacy protocol uses three naming styles. Everything outside this module is snake_case.
LEGACY_KEYS = {
    "download_dir": "download-dir",
    "delete_local_data": "delete-local-data",
    "files_wanted": "files-wanted",
    "files_unwanted": "files-unwanted",
    "priority_high": "priority-high",
    "priority_normal": "priority-normal",
    "priority_low": "priority-low",
    "speed_limit_down": "speed-limit-down",
    "speed_limit_down_enabled": "speed-limit-down-enabled",
    "speed_limit_up": "speed-limit-up",
    "speed_limit_up_enabled": "speed-limit-up-enabled",
    "alt_speed_enabled": "alt-speed-enabled",
    "download_queue_size": "download-queue-size",
    "download_queue_enabled": "download-queue-enabled",
    "incomplete_dir": "incomplete-dir",
    "incomplete_dir_enabled": "incomplete-dir-enabled",
    "seed_ratio_limit": "seedRatioLimit",
    "seed_ratio_limited": "seedRatioLimited",
}


def legacy_key(key: str) -> str:
    if key in LEGACY_KEYS:
        return LEGACY_KEYS[key]
    first, *rest = key.split("_")
    return first + "".join(word.title() for word in rest)


def normalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            re.sub(r"(?<!^)(?=[A-Z])", "_", key).replace("-", "_").lower(): normalize(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [normalize(item) for item in value]
    return value


class TransmissionRPC:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.client = client or httpx.AsyncClient(
            timeout=15,
            auth=(settings.transmission_username, settings.transmission_password)
            if settings.transmission_username
            else None,
            follow_redirects=False,
        )
        self.session_id = ""
        self.modern: bool | None = None
        self._negotiation = asyncio.Lock()

    async def close(self):
        await self.client.aclose()

    async def _send(self, payload: dict) -> dict:
        for _ in range(3):
            try:
                response = await self.client.post(
                    self.settings.transmission_url,
                    json=payload,
                    headers={"X-Transmission-Session-Id": self.session_id},
                )
            except httpx.HTTPError as exc:
                raise RPCError(
                    "Cannot reach Transmission. Check the daemon and RPC connection settings.",
                    unavailable=True,
                ) from exc
            if response.status_code == 409:
                token = response.headers.get("X-Transmission-Session-Id")
                if not token:
                    break
                self.session_id = token
                continue
            if response.status_code in (401, 403):
                raise RPCError(
                    "Transmission rejected the connection. Check RPC credentials and whitelist.",
                    unavailable=True,
                )
            try:
                response.raise_for_status()
                result = response.json()
                if not isinstance(result, dict):
                    raise ValueError("Expected RPC object")
                return result
            except (httpx.HTTPError, ValueError) as exc:
                raise RPCError("Invalid response from Transmission.", unavailable=True) from exc
        raise RPCError("Transmission session negotiation failed.", unavailable=True)

    async def negotiate(self):
        if self.modern is not None:
            return
        async with self._negotiation:
            if self.modern is not None:
                return
            result = await self._send(
                {
                    "jsonrpc": "2.0",
                    "method": "session_get",
                    "params": {"fields": ["version"]},
                    "id": 1,
                }
            )
            if result.get("jsonrpc") == "2.0" and isinstance(result.get("result"), dict):
                self.modern = True
            elif "arguments" in result or result.get("error", {}).get("code") == -32601:
                self.modern = False
            else:
                raise RPCError("Transmission RPC protocol is not supported.", unavailable=True)

    async def call(self, method: str, arguments: dict | None = None) -> dict:
        await self.negotiate()
        args = arguments or {}
        if self.modern:
            payload = {"jsonrpc": "2.0", "method": method, "params": args, "id": 2}
        else:
            args = {
                legacy_key(key): [legacy_key(field) for field in value]
                if key == "fields"
                else value
                for key, value in args.items()
            }
            payload = {"method": method.replace("_", "-"), "arguments": args, "tag": 2}
        result = await self._send(payload)
        if self.modern:
            if "error" in result:
                raise RPCError(
                    str(result["error"].get("message", "Transmission rejected the request."))
                )
            if not isinstance(result.get("result"), dict):
                raise RPCError("Invalid RPC result.", unavailable=True)
            return result["result"]
        if result.get("result") != "success":
            raise RPCError(str(result.get("result", "Transmission rejected the request.")))
        return normalize(result.get("arguments", {}))
