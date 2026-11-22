import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager, suppress
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import Settings
from app.models import AddTorrent, FileSelection, Login, SessionUpdate, TorrentAction
from app.rpc import RPCError, TransmissionRPC
from app.service import TorrentService, public_torrent
from app.streaming import prepare_stream, stream_file


class BodyLimitMiddleware:
    """Bound uploads even when Content-Length is omitted or inaccurate."""

    def __init__(self, app: ASGIApp, limit: int):
        self.app = app
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PATCH"}:
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > self.limit:
                response = JSONResponse({"detail": "Request body is too large."}, status_code=413)
                return await response(scope, receive, send)
            if not message.get("more_body", False):
                break
        consumed = False

        async def replay():
            nonlocal consumed
            if not consumed:
                consumed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


class StateHub:
    """One daemon poll per interval, shared by all connected browsers."""

    def __init__(self, service: TorrentService, interval: float):
        self.service = service
        self.interval = interval
        self.state: dict = {"connected": False, "torrents": [], "stats": {}, "session": {}}
        self.revision = 0
        self.condition = asyncio.Condition()
        self.ready = asyncio.Event()
        self.refresh = asyncio.Event()

    async def run(self):
        while True:
            self.refresh.clear()
            try:
                state = await self.service.snapshot()
            except RPCError as exc:
                state = {**self.state, "connected": False, "error": exc.message}
            async with self.condition:
                self.state = {**state, "updated_at": time.time()}
                self.revision += 1
                self.condition.notify_all()
                self.ready.set()
            with suppress(TimeoutError):
                await asyncio.wait_for(self.refresh.wait(), timeout=self.interval)


def create_app(settings: Settings | None = None, rpc: TransmissionRPC | None = None) -> FastAPI:
    config = settings or Settings()
    client = rpc or TransmissionRPC(config)
    service = TorrentService(client, download_dir=config.download_dir.resolve())
    hub = StateHub(service, config.poll_interval)
    signing_key = (config.session_secret or secrets.token_hex(32)).encode()
    attempts: dict[str, deque] = defaultdict(deque)

    def signed(timestamp: str) -> str:
        return hmac.new(signing_key, timestamp.encode(), hashlib.sha256).hexdigest()

    def authenticated(request: Request) -> bool:
        if not config.app_password:
            return True
        token = request.cookies.get("streamline_session", "")
        try:
            timestamp, signature = token.split(".", 1)
            age = time.time() - int(timestamp)
            return 0 <= age < 7 * 86400 and hmac.compare_digest(signature, signed(timestamp))
        except (ValueError, TypeError):
            return False

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        config.download_dir.mkdir(parents=True, exist_ok=True)
        task = asyncio.create_task(hub.run())
        yield
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        await client.close()

    app = FastAPI(title="Streamline API", version="0.1.0", lifespan=lifespan)
    app.state.service = service
    app.state.hub = hub
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.allowed_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "HEAD", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Range"],
    )

    @app.middleware("http")
    async def access(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                origin = request.headers.get("origin")
                own_origin = f"{request.url.scheme}://{request.headers.get('host', '')}"
                if origin and origin not in [own_origin, *config.allowed_origins]:
                    return JSONResponse(
                        {"detail": "Request origin is not allowed."}, status_code=403
                    )
            if (
                request.url.path not in {"/api/auth", "/api/auth/login", "/api/health"}
                and request.method != "OPTIONS"
                and not authenticated(request)
            ):
                return JSONResponse({"detail": "Sign in to continue."}, status_code=401)
            length = request.headers.get("content-length")
            if length:
                try:
                    if int(length) > config.max_torrent_bytes + 65536:
                        return JSONResponse(
                            {"detail": "Torrent upload is too large."}, status_code=413
                        )
                except ValueError:
                    return JSONResponse({"detail": "Invalid content length."}, status_code=400)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RPCError)
    async def rpc_error(request: Request, exc: RPCError):
        return JSONResponse({"detail": exc.message}, status_code=503 if exc.unavailable else 400)

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "transmission_connected": hub.state["connected"]}

    @app.get("/api/auth")
    async def auth_status(request: Request):
        return {"required": bool(config.app_password), "authenticated": authenticated(request)}

    @app.post("/api/auth/login")
    async def login(body: Login, request: Request):
        key = request.client.host if request.client else "unknown"
        now = time.monotonic()
        queue = attempts[key]
        while queue and now - queue[0] > 60:
            queue.popleft()
        if len(queue) >= 5:
            raise HTTPException(429, "Too many attempts. Try again in a minute.")
        if config.app_password and not hmac.compare_digest(
            body.password.encode(), config.app_password.encode()
        ):
            queue.append(now)
            raise HTTPException(401, "Incorrect password.")
        queue.clear()
        timestamp = str(int(time.time()))
        response = JSONResponse({"authenticated": True})
        response.set_cookie(
            "streamline_session",
            f"{timestamp}.{signed(timestamp)}",
            max_age=7 * 86400,
            httponly=True,
            secure=config.secure_cookies,
            samesite="strict",
            path="/api",
        )
        return response

    @app.post("/api/auth/logout")
    async def logout():
        response = JSONResponse({"authenticated": False})
        response.delete_cookie("streamline_session", path="/api")
        return response

    @app.get("/api/state")
    async def state():
        await hub.ready.wait()
        return hub.state

    @app.get("/api/events")
    async def events(request: Request):
        async def generate():
            revision = -1
            while not await request.is_disconnected():
                async with hub.condition:
                    if revision == hub.revision:
                        try:
                            await asyncio.wait_for(hub.condition.wait(), timeout=15)
                        except TimeoutError:
                            pass
                    revision = hub.revision
                    payload = json.dumps(hub.state, separators=(",", ":"))
                yield f"id: {revision}\nevent: state\ndata: {payload}\n\n"

        return StreamingResponse(
            generate(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"}
        )

    @app.post("/api/torrents", status_code=201)
    async def add_torrent(body: AddTorrent):
        result = await client.call(
            "torrent_add",
            {
                "filename": body.magnet,
                "paused": body.paused,
                "download_dir": str(config.download_dir.resolve()),
            },
        )
        hub.refresh.set()
        return result

    @app.post("/api/torrents/upload", status_code=201)
    async def upload_torrent(file: Annotated[UploadFile, File()], paused: bool = False):
        if not file.filename or not file.filename.lower().endswith(".torrent"):
            raise HTTPException(422, "Choose a .torrent file.")
        content = await file.read(config.max_torrent_bytes + 1)
        await file.close()
        if not content or len(content) > config.max_torrent_bytes:
            raise HTTPException(413, "Torrent must be nonempty and at most 8 MiB.")
        result = await client.call(
            "torrent_add",
            {
                "metainfo": base64.b64encode(content).decode(),
                "paused": paused,
                "download_dir": str(config.download_dir.resolve()),
            },
        )
        hub.refresh.set()
        return result

    @app.get("/api/torrents/{torrent_id}")
    async def torrent_detail(torrent_id: str):
        return public_torrent(await service.get(torrent_id, pieces=True), detail=True)

    @app.post("/api/torrents/{torrent_id}/action")
    async def action(torrent_id: str, body: TorrentAction):
        torrent = await service.get(torrent_id)
        method = {
            "start": "torrent_start",
            "pause": "torrent_stop",
            "verify": "torrent_verify",
            "reannounce": "torrent_reannounce",
        }[body.action]
        await client.call(method, {"ids": [torrent["hash_string"]]})
        hub.refresh.set()
        return {"ok": True}

    @app.delete("/api/torrents/{torrent_id}")
    async def remove(torrent_id: str, delete_data: bool = False):
        torrent = await service.get(torrent_id)
        await client.call(
            "torrent_remove", {"ids": [torrent["hash_string"]], "delete_local_data": delete_data}
        )
        hub.refresh.set()
        return {"ok": True}

    @app.patch("/api/torrents/{torrent_id}/files/{file_index}")
    async def select_file(torrent_id: str, file_index: int, body: FileSelection):
        torrent = await service.get(torrent_id)
        service.file(torrent, file_index)
        args = {"ids": [torrent["hash_string"]]}
        if body.wanted is not None:
            args["files_wanted" if body.wanted else "files_unwanted"] = [file_index]
        if body.priority is not None:
            args[{-1: "priority_low", 0: "priority_normal", 1: "priority_high"}[body.priority]] = [
                file_index
            ]
        if len(args) == 1:
            raise HTTPException(422, "Provide wanted or priority.")
        await client.call("torrent_set", args)
        hub.refresh.set()
        return {"ok": True}

    @app.post("/api/torrents/{torrent_id}/files/{file_index}/prepare")
    async def prepare(torrent_id: str, file_index: int):
        result = await prepare_stream(service, torrent_id, file_index)
        hub.refresh.set()
        return result

    @app.api_route("/api/torrents/{torrent_id}/files/{file_index}/stream", methods=["GET", "HEAD"])
    async def stream(request: Request, torrent_id: str, file_index: int):
        return await stream_file(request, service, config, torrent_id, file_index)

    @app.patch("/api/session")
    async def update_session(body: SessionUpdate):
        await client.call("session_set", body.model_dump(exclude_none=True))
        hub.refresh.set()
        return {"ok": True}

    # Serve the Vite build in production, with explicit API 404s and safe SPA fallback.
    frontend = config.frontend_dir.resolve()
    if (frontend / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def frontend_route(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "API endpoint not found.")
        candidate = (frontend / path).resolve()
        if candidate.is_relative_to(frontend) and candidate.is_file():
            return FileResponse(candidate)
        if (frontend / "index.html").is_file():
            return FileResponse(frontend / "index.html")
        raise HTTPException(404, "Frontend is not built. Run the Vite dev server or npm run build.")

    app.add_middleware(BodyLimitMiddleware, limit=config.max_torrent_bytes + 65536)
    return app


app = create_app()
