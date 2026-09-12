"""ParkTech. One command starts everything.

    python run.py                          # replay PUCPR, serve on :8100
    python run.py --camera UFPR04 --fps 4
    python run.py --headless --limit 20    # no server, just print state

Replay, inference, occupancy, the database writes, the MJPEG stream and the
WebSocket all run in this one process. No separate worker, no curl workflow.
"""

import argparse
import json
import sys
import threading
from pathlib import Path

REPO = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO))

import cv2

from parktech import db, pklot, uniform
from parktech import layout as layout_mod
from parktech.pipeline import Pipeline

DATA = REPO / "data" / "PKLot"
ROWS = REPO / "config" / "rows.json"


def build_layout(frames, camera_id):
    """Stall geometry for the top-down view, derived from the real annotations.

    Must come from the same XML the occupancy engine reads, otherwise the
    layout and the state disagree about which stalls exist and the twin
    renders nothing.
    """
    jpg, xml = frames[0]
    spaces = pklot.parse_spaces(xml)
    image = cv2.imread(str(jpg))
    height, width = image.shape[:2]

    # Row grouping is configured per camera. Automatic detection works on
    # straight lots but merges rows that touch, so an explicit grouping wins
    # where one exists.
    row_spec, drivable = None, None
    if ROWS.exists():
        with open(ROWS) as fh:
            cams = json.load(fh)
        cfg = cams.get(camera_id) or {}
        row_spec = cfg.get("rows")
        drivable = cfg.get("drivable_gaps")
        if row_spec:
            print(f"layout: {len(row_spec)} rows configured for {camera_id}")
        else:
            print(f"layout: no row config for {camera_id}, detecting rows")

    built = uniform.to_layout(
        spaces, camera_id, row_spec=row_spec, drivable_gaps=drivable,
        lot_name=f"PKLot {camera_id}",
    )
    print(f"layout: {len(built['spots'])} stalls, "
          f"aisles at gaps {built['drivable_gaps']}")

    # Vehicles are placed on the stall they occupy rather than warped
    # independently, so a car can never appear off its own stall on the map.
    projector = layout_mod.make_projector(spaces, (width, height), None)
    return built, projector


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", default="PUCPR")
    ap.add_argument("--fps", type=float, default=2.0,
                    help="replay speed. A day of 5 minute stills at 2fps is ~2.5 min")
    # 0.0.0.0, not 127.0.0.1. `localhost` resolves to IPv6 ::1 first on macOS,
    # and a server bound only to 127.0.0.1 refuses that connection. curl retries
    # over IPv4 and hides the problem; Vite's proxy does not, so /api and /ws
    # came back as 502 and the twin silently froze on its first payload.
    ap.add_argument("--host", default="0.0.0.0")
    # 8000 is a crowded default and already taken on this machine by another
    # project. 8100 keeps ParkTech out of the way.
    ap.add_argument("--port", type=int, default=8100)
    ap.add_argument("--headless", action="store_true",
                    help="no server, print state to stdout")
    ap.add_argument("--limit", type=int, default=0,
                    help="headless only: stop after N frames")
    ap.add_argument("--no-loop", action="store_true")
    ap.add_argument("--start", default=None,
                    help="begin replay at this time of day, e.g. 11:30. The "
                         "dataset opens before dawn on an empty lot, which is "
                         "a poor thing to open a demo on.")
    args = ap.parse_args()

    dirs = pklot.camera_dirs(DATA, args.camera)
    if not dirs:
        sys.exit(
            f"No camera {args.camera} under {DATA}\n"
            "Extract PKLot.tar.gz into data/ first."
        )

    try:
        db.init()
    except Exception as exc:  # noqa: BLE001
        # Any failure reaching the database is fatal and the cause varies by
        # driver, so report whatever it was rather than guessing at types.
        sys.exit(
            f"Database unavailable: {exc}\n"
            "Start it with: docker compose up -d"
        )

    pipeline = Pipeline(
        dirs[0], args.camera, fps=args.fps, loop=not args.no_loop
    )
    if args.start:
        pipeline.seek(args.start)
    layout, projector = build_layout(pipeline.frames, args.camera)
    pipeline.layout = layout["spots"]
    pipeline.projector = projector
    print(f"camera {args.camera}: {len(pipeline.frames)} annotated frames")

    if args.headless:
        for i, (jpg, xml) in enumerate(pipeline.frames, 1):
            state = pipeline.process_frame(jpg, xml)
            s = state["summary"]
            line = (
                f"{state['timestamp']}  "
                f"{s['available']:>2} free / {s['total']:>2}  "
                f"acc {s['accuracy']}"
            )
            if state["last_event"]:
                e = state["last_event"]
                line += f"   {e['spot_id']}: {e['from']} -> {e['to']}"
            print(line)
            if args.limit and i >= args.limit:
                break
        return 0

    import uvicorn

    from parktech.api import create_app

    app = create_app(pipeline, layout)
    threading.Thread(target=pipeline.run, daemon=True).start()

    print(f"http://{args.host}:{args.port}/api/state")
    print(f"http://{args.host}:{args.port}/video")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
