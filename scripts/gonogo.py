"""The go/no-go test. Run this before building anything else.

The single question it answers: does pretrained YOLO see the parked cars in PKLot
frames well enough to be worth the next 20 hours?

The number that actually matters is not the detection count, it is the median box
size in pixels. COCO-pretrained YOLO degrades sharply below roughly 30px, and a
distant parking camera is exactly the situation that produces tiny boxes. That is
the same domain-gap failure that ate the football kick analyzer, so measure it
first rather than discovering it at hour 6.

    python scripts/gonogo.py                      # auto-picks a frame
    python scripts/gonogo.py --camera UFPR05      # try a closer camera
    python scripts/gonogo.py --model yolo11s.pt --imgsz 1280 --conf 0.2

Escalation order if the verdict is bad, per PRD.md:
    1. yolo11s instead of yolo11n
    2. imgsz 1280
    3. conf 0.2
    4. a different camera (UFPR04 / UFPR05 / PUCPR differ in distance)
    5. pivot. Do not fine-tune.
"""

import argparse
import statistics
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data" / "PKLot"

# COCO classes we count as a parked vehicle
VEHICLE_CLASSES = {2: "car", 5: "bus", 7: "truck"}


def find_frame(camera=None):
    """Pick any PKLot frame that has a matching XML, so we can sanity check both."""
    if not DATA.exists():
        sys.exit(
            f"No dataset at {DATA}\n"
            "Extract PKLot.tar.gz there first, then rerun."
        )

    roots = [DATA / camera] if camera else sorted(
        p for p in DATA.rglob("*") if p.is_dir() and p.name in
        {"UFPR04", "UFPR05", "PUCPR"}
    )
    for root in roots:
        if not root.exists():
            continue
        for jpg in sorted(root.rglob("*.jpg")):
            if jpg.with_suffix(".xml").exists():
                return jpg
    sys.exit(f"Found no .jpg with a matching .xml under {roots}")


def count_ground_truth(xml_path):
    """How many spaces the dataset says are occupied in this frame."""
    import xml.etree.ElementTree as ET

    try:
        root = ET.parse(xml_path).getroot()
    except ET.ParseError as exc:
        print(f"  ! could not parse {xml_path.name}: {exc}")
        return None, None
    spaces = root.findall(".//space")
    occupied = sum(1 for s in spaces if s.get("occupied") == "1")
    return len(spaces), occupied


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", default=None, help="UFPR04, UFPR05 or PUCPR")
    ap.add_argument("--model", default="yolo11n.pt")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--frame", default=None, help="path to a specific .jpg")
    ap.add_argument("--save", default="gonogo_out.jpg", help="annotated output")
    args = ap.parse_args()

    frame = Path(args.frame) if args.frame else find_frame(args.camera)
    print(f"frame  : {frame.relative_to(REPO) if REPO in frame.parents else frame}")

    total_spaces, gt_occupied = count_ground_truth(frame.with_suffix(".xml"))
    if total_spaces is not None:
        print(f"truth  : {gt_occupied} occupied of {total_spaces} annotated spaces")

    from ultralytics import YOLO

    model = YOLO(args.model)
    result = model.predict(
        str(frame), imgsz=args.imgsz, conf=args.conf, verbose=False
    )[0]

    boxes = [b for b in result.boxes if int(b.cls) in VEHICLE_CLASSES]
    print(f"model  : {args.model}  imgsz={args.imgsz}  conf={args.conf}")
    print(f"detect : {len(boxes)} vehicles")

    if not boxes:
        print("\nVERDICT: NO GO. Zero vehicles detected. Escalate per the docstring.")
        return 1

    widths, heights, confs = [], [], []
    for b in boxes:
        x1, y1, x2, y2 = (float(v) for v in b.xyxy[0])
        widths.append(x2 - x1)
        heights.append(y2 - y1)
        confs.append(float(b.conf))

    med_w = statistics.median(widths)
    med_h = statistics.median(heights)
    min_dim = min(min(widths), min(heights))
    print(f"box    : median {med_w:.0f}x{med_h:.0f} px, smallest side {min_dim:.0f} px")
    print(f"conf   : median {statistics.median(confs):.2f}, "
          f"min {min(confs):.2f}, max {max(confs):.2f}")

    result.save(filename=args.save)
    print(f"saved  : {args.save}")

    # The verdict. Recall against ground truth matters more than raw count.
    print()
    if total_spaces and gt_occupied:
        recall = len(boxes) / gt_occupied
        print(f"recall : {recall:.0%} of occupied spaces have a detection")
        if recall < 0.7:
            print("VERDICT: NO GO at these settings. Escalate per the docstring.")
            return 1

    if min(med_w, med_h) < 30:
        print("VERDICT: MARGINAL. Boxes are small enough to be the known failure mode.")
        print("         Try --imgsz 1280 and --model yolo11s.pt before accepting this.")
        return 1

    print("VERDICT: GO. Open the saved image and confirm the boxes sit on real cars.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
