"""HTTP and WebSocket surface.

Endpoints match contracts/README.md. The frontend is built against that
contract, so changes here are additive only.
"""

import asyncio
import json

from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from parktech import db, routing


def create_app(pipeline, layout):
    app = FastAPI(title="ParkTech")

    # The frontend dev server runs on another port. This is a demo running on
    # one laptop, not something exposed to a network.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
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
        """The lane network, and a few places a driver could be waiting.

        The demo routes from each of these to whichever stall is clicked, so a
        judge can see that every path follows the lanes.
        """
        nodes = layout.get("aisles", {}).get("nodes", {})
        starts = [n for n in nodes if n.startswith(("L", "R"))] or list(nodes)
        return {
            "nodes": nodes,
            "edges": layout.get("aisles", {}).get("edges", []),
            "driver_starts": ["entrance", *starts[:3]],
        }

    @app.get("/api/analytics")
    def get_analytics(hours: int = 24):
        # Refresh on read. The background policy runs on a schedule, which is
        # too slow when a demo has just replayed a day and a judge is looking.
        try:
            db.refresh_analytics()
        except Exception as exc:  # noqa: BLE001
            print(f"aggregate refresh failed: {exc!r}")
        rows = db.occupancy_history(pipeline.camera_id, hours)
        levels = db.occupancy_levels(pipeline.camera_id, hours)
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
                for t, spot, status in db.recent_events(pipeline.camera_id)
            ],
        }

    @app.get("/video")
    def video():
        def frames():
            while True:
                jpeg = pipeline.annotated
                if jpeg:
                    yield (
                        b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
                        + jpeg
                        + b"\r\n"
                    )
                import time as _time

                _time.sleep(0.2)

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
