"""ParkTech. One command starts everything.

    python run.py                          # replay UFPR04, serve on :8000
    python run.py --camera UFPR05 --fps 4
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

from parktech import db, pklot
from parktech import layout as layout_mod
from parktech.pipeline import Pipeline

DATA = REPO / "data" / "PKLot"
HOMOGRAPHY = REPO / "config" / "homography.json"


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

    homography = None
    if HOMOGRAPHY.exists():
        with open(HOMOGRAPHY) as fh:
            homography = json.load(fh).get("matrix")

    return layout_mod.from_spaces(
        spaces, (width, height), camera_id,
        lot_name=f"PKLot {camera_id}", homography=homography,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", default="UFPR04")
    ap.add_argument("--fps", type=float, default=2.0,
                    help="replay speed. A day of 5 minute stills at 2fps is ~2.5 min")
    ap.add_argument("--host", default="127.0.0.1")
    # 8000 is a crowded default and already taken on this machine by another
    # project. 8100 keeps ParkTech out of the way.
    ap.add_argument("--port", type=int, default=8100)
    ap.add_argument("--headless", action="store_true",
                    help="no server, print state to stdout")
    ap.add_argument("--limit", type=int, default=0,
                    help="headless only: stop after N frames")
    ap.add_argument("--no-loop", action="store_true")
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
    layout = build_layout(pipeline.frames, args.camera)
    pipeline.layout = layout["spots"]
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
