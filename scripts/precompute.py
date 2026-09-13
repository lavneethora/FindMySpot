"""Precompute detections so the demo never waits on the GPU.

yolo11m at 1920px takes about 1.3s a frame here, which is fine for measuring
accuracy and too slow to drive a demo. Detections for a fixed camera replaying
fixed frames are deterministic, so compute them once and read them back.

Run this before the demo, once, for the window you intend to show:

    python scripts/precompute.py --start 11:30 --frames 400

Then `python run.py` picks the cache up automatically and replays at whatever
speed you ask for. It falls back to live inference if the cache is missing or
was built with different settings, so a stale file can never quietly serve the
wrong detections.
"""

import argparse
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from parktech import cache, pklot
from parktech.pipeline import CONF, IMGSZ, MODEL, VEHICLE_CLASSES

DATA = REPO / "data" / "PKLot"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", default="PUCPR")
    ap.add_argument("--start", default="11:30",
                    help="time of day to begin, matching run.py --start")
    ap.add_argument("--frames", type=int, default=400,
                    help="how many frames to precompute from that point")
    args = ap.parse_args()

    dirs = pklot.camera_dirs(DATA, args.camera)
    if not dirs:
        sys.exit(f"No camera {args.camera} under {DATA}")

    frames = list(pklot.iter_frames(dirs[0]))
    if not frames:
        sys.exit(f"No annotated frames for {args.camera}")

    # Rotate to the start time the demo will use, so the cache covers exactly
    # the window that gets shown.
    for index, (jpg, _xml) in enumerate(frames):
        captured = pklot.capture_time(jpg)
        if captured and captured.strftime("%H:%M") >= args.start:
            frames = frames[index:] + frames[:index]
            break
    frames = frames[:args.frames]

    from ultralytics import YOLO

    model = YOLO(MODEL)
    print(f"{args.camera}: {len(frames)} frames, {MODEL} @{IMGSZ} conf={CONF}")

    detections = {}
    started = time.monotonic()
    for i, (jpg, _xml) in enumerate(frames, 1):
        result = model.predict(
            str(jpg), imgsz=IMGSZ, conf=CONF, verbose=False
        )[0]
        rows = []
        for box in result.boxes:
            if int(box.cls) in VEHICLE_CLASSES:
                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                rows.append([x1, y1, x2, y2, float(box.conf)])
        detections[jpg.name] = rows

        if i % 25 == 0 or i == len(frames):
            elapsed = time.monotonic() - started
            rate = i / elapsed
            remaining = (len(frames) - i) / rate if rate else 0
            print(f"  {i}/{len(frames)}  {rate:.2f} fps  "
                  f"{remaining/60:.1f} min left")

    target = cache.save(args.camera, MODEL, IMGSZ, CONF, detections)
    size_mb = target.stat().st_size / 1e6
    total = sum(len(v) for v in detections.values())
    print(f"\nsaved {target.relative_to(REPO)}  ({size_mb:.1f} MB)")
    print(f"{total} detections across {len(detections)} frames")
    print("run.py will use this automatically.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
