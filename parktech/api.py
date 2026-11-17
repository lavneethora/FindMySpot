"""HTTP and WebSocket surface.

Endpoints match contracts/README.md. The frontend is built against that
contract, so changes here are additive only.
"""

import asyncio
import json
import os
import threading
import time

from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from parktech import db, routing

# Nothing here sits behind a login, so each endpoint that costs something is
# bounded. Analytics is recomputed at most this often however many people ask.
ANALYTICS_TTL_SECONDS = 30
ANALYTICS_MAX_HOURS = 168

# Each /video viewer occupies a worker thread for as long as the tab is open.
# The pool has 40, shared with every other endpoint, so viewers are capped well
# below that and the rest are refused instead of starving the API.
MAX_VIDEO_CLIENTS = 12
VIDEO_KEEPALIVE_SECONDS = 10
VIDEO_STALE_SECONDS = 30

MAX_SESSION_ID_LENGTH = 64


def create_app(pipeline, layout):
    app = FastAPI(title="FindMySpot")

    # The frontend is served from somewhere else: another port in development,
    # another host once deployed. Either way the browser needs permission.
    #
    # ALLOWED_ORIGINS narrows this to a comma separated list when the pipeline
    # is reachable from the internet. Left unset it stays open, which is right
    # for a laptop and wrong for a public host, so set it when you deploy.
    configured = os.environ.get("ALLOWED_ORIGINS", "").strip()
    origins = [o.strip() for o in configured.split(",") if o.strip()] or ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Captured once the server is actually running, NOT here. get_event_loop() at
    # build time returns a loop uvicorn never runs, so every broadcast was
    # scheduled onto a dead loop: a browser received the state sent on connect
    # and then nothing, which looks exactly like a frozen map.
    loop: asyncio.AbstractEventLoop | None = None

    @app.on_event("startup")
    async def _capture_loop():
        nonlocal loop
        loop = asyncio.get_running_loop()

    clients: set[WebSocket] = set()

    def on_state(payload):
        """Called from the pipeline thread, so hop onto the event loop."""
        if loop is None:
            return
        message = json.dumps(payload)
        asyncio.run_coroutine_threadsafe(broadcast(message), loop)

    async def broadcast(message):
        dead = []
        for ws in list(clients):
            try:
                await ws.send_text(message)
            except Exception:  # noqa: BLE001
                # Any send failure means the client is gone. Drop it.
                dead.append(ws)
        for ws in dead:
            clients.discard(ws)

    pipeline.subscribe(on_state)

    @app.get("/api/layout")
    def get_layout():
        return layout

    @app.get("/api/state")
    def get_state():
        return pipeline.state

    @app.post("/api/hold")
    def post_hold(body: dict, response: Response):
        spot_id = body.get("spot_id")
        session_id = body.get("session_id", "anonymous")
        if not spot_id:
            response.status_code = 400
            return {"error": "spot_id is required"}
        # Only stalls that exist, and a session id of sane size. Without this
        # anyone could fill the holds table with rows for made-up stalls.
        if not isinstance(spot_id, str) or spot_id not in layout.get("spots", {}):
            response.status_code = 404
            return {"error": "unknown spot_id"}
        if (
            not isinstance(session_id, str)
            or not 0 < len(session_id) <= MAX_SESSION_ID_LENGTH
        ):
            response.status_code = 400
            return {"error": "session_id is not valid"}

        until = db.place_hold(pipeline.camera_id, spot_id, session_id)
        if until is None:
            # Someone else already holds it. This is a 409 and not a 200, so a
            # client checking response.ok cannot mistake a refusal for a grant
            # and end up with a hold that never expires.
            response.status_code = 409
            return {"error": "already held", "spot_id": spot_id}

        return {
            "spot_id": spot_id,
            "held_until": until.isoformat(),
            "route": route_to(spot_id, layout),
        }

    @app.get("/api/route/{spot_id}")
    def get_route(spot_id: str, from_node: str = "entrance"):
        """The way to a stall, without claiming it.

        Holds were removed from the driver view: nothing physically stops
        another car taking a space, so telling a driver it is theirs is a
        promise the product cannot keep. Showing the way there is one it can.

        `from_node` lets several drivers be routed to the same stall from
        different places in the lot, which is what makes the lane network
        visible: every route bends around the rows instead of crossing them.
        """
        return {
            "spot_id": spot_id,
            "from": from_node,
            "route": route_to(spot_id, layout, from_node),
        }

    @app.get("/api/lanes")
    def get_lanes():
        """The lane network, and the simulated starting positions.

        These are the same driver placed at several points, not other cars in
        the lot. Routing from each to whichever stall is clicked shows the
        routing adapting: same stall, different start, different way round.
        """
        return {
            "nodes": layout.get("aisles", {}).get("nodes", {}),
            "edges": layout.get("aisles", {}).get("edges", []),
            "entrance": layout.get("entrance"),
            "drivers": routing.simulated_drivers(layout),
        }

    @app.get("/api/routes/{spot_id}")
    def get_all_routes(spot_id: str):
        """Every way to one stall: the driver's own, and from each simulated position.

        The simulated positions are the same driver placed elsewhere, so a judge
        can see the routing solve the lot from more than one starting point.
        """
        drivers = routing.simulated_drivers(layout)
        return {
            "spot_id": spot_id,
            "entrance": route_to(spot_id, layout, "entrance"),
            "drivers": [
                {
                    "id": d["id"],
                    "x": d["x"],
                    "y": d["y"],
                    "route": routing.route_from_driver(layout, d, spot_id),
                }
                for d in drivers
            ],
        }

    analytics_cache: dict[int, tuple[float, dict]] = {}
    analytics_lock = threading.Lock()

    @app.get("/api/analytics")
    def get_analytics(hours: int = 24):
        """Occupancy history, recomputed at most every ANALYTICS_TTL_SECONDS.

        Refreshing the aggregate takes seconds. Doing it on every request let
        a handful of callers tie up the database and the worker threads. The
        lock means a burst waits for one refresh and then shares its answer.
        """
        hours = max(1, min(hours, ANALYTICS_MAX_HOURS))
        with analytics_lock:
            cached = analytics_cache.get(hours)
            if cached and time.monotonic() - cached[0] < ANALYTICS_TTL_SECONDS:
                return cached[1]
            payload = compute_analytics(hours)
            analytics_cache[hours] = (time.monotonic(), payload)
            return payload

    def compute_analytics(hours):
        # Refresh on read. The background policy runs on a schedule, which is
        # too slow when a demo has just replayed a day and a judge is looking.
        # An unreachable database returns empty history rather than a 500. The
        # map and the camera panel do not depend on it, so one dead panel beats
        # an error the rest of the page has no reason to share.
        try:
            db.refresh_analytics()
            rows = db.occupancy_history(pipeline.camera_id, hours)
            levels = db.occupancy_levels(pipeline.camera_id, hours)
            recent = db.recent_events(pipeline.camera_id)
        except Exception as exc:  # noqa: BLE001
            print(f"analytics unavailable: {exc!r}")
            rows, levels, recent = [], [], []
        return {
            "camera_id": pipeline.camera_id,
            # The occupancy curve. Transition counts below are arrivals and
            # departures, which is a different question and cannot be summed
            # into a level without knowing where the count started.
            "levels": [
                {
                    "t": bucket.isoformat(),
                    "occupied": round(avg_occ, 1),
                    "peak": peak,
                    "total": total,
                }
                for bucket, avg_occ, peak, total in levels
            ],
            "buckets": [
                {
                    "t": bucket.isoformat(),
                    "became_occupied": occupied,
                    "became_available": available,
                }
                for bucket, occupied, available in rows
            ],
            "recent": [
                {"t": t.isoformat(), "spot_id": spot, "status": status}
                for t, spot, status in recent
            ],
        }

    # Viewer id -> when its stream last ran. A closed tab is only discovered
    # when a send fails, and after that the generator is left suspended until
    # the garbage collector reaches it, so a count kept in a `finally` frees
    # slots late or not at all. A viewer that has not run recently is treated
    # as gone instead.
    viewers: dict[int, float] = {}
    viewer_ids = iter(range(1, 2**62))
    video_lock = threading.Lock()

    def live_viewers():
        now = time.monotonic()
        with video_lock:
            for gone in [v for v, t in viewers.items() if now - t > VIDEO_STALE_SECONDS]:
                del viewers[gone]
            return len(viewers)

    @app.get("/video")
    def video(response: Response):
        if live_viewers() >= MAX_VIDEO_CLIENTS:
            response.status_code = 503
            response.headers["Retry-After"] = "30"
            return {"error": "too many viewers, try again shortly"}

        with video_lock:
            me = next(viewer_ids)
            viewers[me] = time.monotonic()

        def frames():
            try:
                yield from stream(me)
            finally:
                with video_lock:
                    viewers.pop(me, None)

        def stream(me):
            # Send a frame only when the pipeline has made a new one. This used
            # to resend whatever was current every 0.2s, so at 2 fps replay 60%
            # of the stream was the same frame again: about 1.9 GB an hour per
            # open operator tab, which exhausted a free tier's bandwidth.
            # Checking identity is free; nothing goes on the wire until the
            # frame actually changes.
            #
            # With nothing new for a while the current frame is sent once more.
            # A closed tab is only noticed when a send fails, so without this a
            # paused pipeline would keep every departed viewer's thread forever.
            last = None
            sent_at = 0.0
            while True:
                jpeg = pipeline.annotated
                now = time.monotonic()
                viewers[me] = now
                if jpeg and (
                    jpeg is not last or now - sent_at > VIDEO_KEEPALIVE_SECONDS
                ):
                    last = jpeg
                    sent_at = now
                    yield (
                        b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                        + jpeg
                        + b"\r\n"
                    )
                time.sleep(0.05)

        return StreamingResponse(
            frames(), media_type="multipart/x-mixed-replace; boundary=frame"
        )

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        clients.add(websocket)
        try:
            if pipeline.state:
                await websocket.send_text(json.dumps(pipeline.state))
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            clients.discard(websocket)

    return app


def route_to(spot_id, layout, start_node="entrance"):
    """Lane-following route to a stall. See parktech/routing.py.

    In-lot routing only. Consumer GPS is accurate to 3 to 5 metres, which is
    wider than a stall, so this is drawn on our own map rather than handed to a
    turn by turn navigator.
    """
    return routing.route_to_stall(layout, spot_id, start_node)
