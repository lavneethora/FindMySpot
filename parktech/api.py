"""HTTP and WebSocket surface.

Endpoints match contracts/README.md. The frontend is built against that
contract, so changes here are additive only.
"""

import asyncio
import json

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from parktech import db


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

    loop = asyncio.get_event_loop()
    clients: set[WebSocket] = set()

    def on_state(payload):
        """Called from the pipeline thread, so hop onto the event loop."""
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
    def post_hold(body: dict):
        spot_id = body.get("spot_id")
        session_id = body.get("session_id", "anonymous")
        if not spot_id:
            return {"error": "spot_id is required"}

        until = db.place_hold(pipeline.camera_id, spot_id, session_id)
        if until is None:
            # Someone else already holds it. Saying so is the whole point of
            # the feature: two drivers must never be sent to one stall.
            return {"error": "already held", "spot_id": spot_id}

        return {
            "spot_id": spot_id,
            "held_until": until.isoformat(),
            "route": route_to(spot_id, layout),
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
        return {
            "camera_id": pipeline.camera_id,
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


def route_to(spot_id, layout):
    """Entrance to stall, through the aisle graph. Normalized coordinates.

    In-lot routing only. Consumer GPS is accurate to 3 to 5 metres, which is
    wider than a stall, so this is drawn on our own map rather than handed to
    a turn by turn navigator.
    """
    spots = layout.get("spots", {})
    if spot_id not in spots:
        return []

    entrance = layout.get("entrance", {"x": 0.5, "y": 0.98})
    target = spots[spot_id].get("centroid", [0.5, 0.5])
    nodes = layout.get("aisles", {}).get("nodes", {})

    path = [[entrance["x"], entrance["y"]]]
    if "main" in nodes:
        path.append(list(nodes["main"]))
    # Nearest aisle node to the stall, so the path runs down an aisle rather
    # than straight across parked cars.
    aisle_nodes = [(k, v) for k, v in nodes.items() if k not in ("entrance", "main")]
    if aisle_nodes:
        nearest = min(
            aisle_nodes,
            key=lambda kv: (kv[1][0] - target[0]) ** 2 + (kv[1][1] - target[1]) ** 2,
        )
        path.append(list(nearest[1]))
    path.append(list(target))
    return path
