"""Measure per-space occupancy accuracy against PKLot ground truth.

This is the number the whole project rests on. The go/no-go only proved YOLO
sees cars somewhere in the frame; this proves we get the right answer for each
annotated space, which is a different and much harder question.

Reported without debouncing by default, because debouncing is a presentation
smoothing step and folding it in here would flatter the detector.

    python scripts/accuracy.py --camera UFPR04 --limit 40
    python scripts/accuracy.py --camera UFPR04 --weather Sunny --model yolo11s.pt --imgsz 1280
"""

import argparse
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from parktech import occupancy, pklot

DATA = REPO / "data" / "PKLot"
VEHICLE_CLASSES = {2, 5, 7}  # COCO car, bus, truck


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", default="UFPR04")
    ap.add_argument("--weather", default=None, help="Sunny, Cloudy or Rainy")
    ap.add_argument("--limit", type=int, default=40, help="frames to score")
    ap.add_argument("--model", default="yolo11n.pt")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--method", default="overlap",
                    choices=("point", "centroid", "overlap"))
    ap.add_argument("--threshold", type=float, default=0.35,
                    help="overlap method only: stall coverage needed to call it taken")
    ap.add_argument("--consecutive", action="store_true",
                    help="score the first N frames instead of striding across all of them")
    args = ap.parse_args()

    dirs = pklot.camera_dirs(DATA, args.camera)
    if not dirs:
        sys.exit(f"No camera directory for {args.camera} under {DATA}")
    root = dirs[0]
    if args.weather:
        root = root / args.weather
        if not root.exists():
            sys.exit(f"No {args.weather} frames for {args.camera}")

    # Consecutive frames come from one morning and are nearly all occupied, which
    # measures almost nothing about calling a stall free. Stride across everything
    # available instead, so the sample spans days, weather and times of day.
    everything = list(pklot.iter_frames(root))
    if not everything:
        sys.exit(f"No annotated frames under {root}")

    if args.consecutive:
        frames = everything[:args.limit]
    else:
        stride = max(1, len(everything) // args.limit)
        frames = everything[::stride][:args.limit]

    from ultralytics import YOLO

    model = YOLO(args.model)

    # tp: correctly called occupied. tn: correctly called free.
    # fp: called occupied while truly free. fn: called free while truly occupied.
    tally = Counter()
    per_space_wrong = Counter()
    scored_frames = 0

    for jpg, xml in frames:
        spaces = pklot.parse_spaces(xml)
        truth = {s.id: s.occupied for s in spaces if s.occupied is not None}
        if not truth:
            continue

        result = model.predict(
            str(jpg), imgsz=args.imgsz, conf=args.conf, verbose=False
        )[0]
        boxes = [
            [float(v) for v in b.xyxy[0]]
            for b in result.boxes
            if int(b.cls) in VEHICLE_CLASSES
        ]

        if args.method == "point":
            predicted = occupancy.assign(
                spaces, [occupancy.bottom_centre(b) for b in boxes]
            )
        elif args.method == "centroid":
            predicted = occupancy.assign_centroid_in_box(spaces, boxes)
        else:
            predicted = occupancy.assign_overlap(spaces, boxes, args.threshold)
        scored_frames += 1

        for sid, actually_occupied in truth.items():
            called_occupied = predicted[sid]
            if called_occupied and actually_occupied:
                tally["tp"] += 1
            elif not called_occupied and not actually_occupied:
                tally["tn"] += 1
            elif called_occupied and not actually_occupied:
                tally["fp"] += 1
                per_space_wrong[sid] += 1
            else:
                tally["fn"] += 1
                per_space_wrong[sid] += 1

    total = sum(tally.values())
    if not total:
        sys.exit("Nothing scored: no ground truth labels found")

    correct = tally["tp"] + tally["tn"]
    accuracy = correct / total
    truly_occupied = tally["tp"] + tally["fn"]
    truly_free = tally["tn"] + tally["fp"]

    print(f"camera   : {args.camera}" + (f" / {args.weather}" if args.weather else ""))
    print(f"model    : {args.model}  imgsz={args.imgsz}  conf={args.conf}  method={args.method}")
    print(f"frames   : {scored_frames}")
    print(f"decisions: {total}  ({truly_occupied} truly occupied, "
          f"{truly_free} truly free)")
    print()
    print(f"ACCURACY : {accuracy:.1%}")
    print()
    print("                 called occupied   called free")
    print(f"truly occupied   {tally['tp']:>15}   {tally['fn']:>11}")
    print(f"truly free       {tally['fp']:>15}   {tally['tn']:>11}")
    print()

    # A spot that is wrong in most frames is usually occluded or badly framed,
    # not a detector problem. Worth knowing before blaming the model.
    if per_space_wrong:
        worst = per_space_wrong.most_common(5)
        print("worst spaces (errors / frames):")
        for sid, n in worst:
            print(f"  space {sid:>3}  {n}/{scored_frames}")

    if accuracy < 0.85:
        print("\nBelow 85%. Escalate: yolo11s, imgsz 1280, conf 0.2, or another camera.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
