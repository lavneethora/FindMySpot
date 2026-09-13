"""Calibrate a camera by clicking four ground points.

    python calibrate.py                 # opens a window, click 4 corners
    python calibrate.py --camera UFPR05
    python calibrate.py --points 100,200 900,210 1100,700 60,690   # no window

Click four points that form a **rectangle on the ground in real life**, in
order: top left, top right, bottom right, bottom left. Good choices are the
outer corners of a block of stalls, or painted lines. They must all lie flat on
the tarmac. A point up a light pole or on a roof will produce a warp that fans
out instead of squaring up, and the quality check below will tell you so.

Writes config/homography.json. run.py picks it up automatically on next start.
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO))

import cv2

from parktech import homography, pklot

DATA = REPO / "data" / "PKLot"
OUT = REPO / "config" / "homography.json"

LABELS = ("top left", "top right", "bottom right", "bottom left")


def pick_points(image):
    """Open a window and collect four clicks."""
    points = []
    display = image.copy()
    window = "FindMySpot calibration"

    def redraw():
        frame = display.copy()
        for i, (x, y) in enumerate(points):
            cv2.circle(frame, (x, y), 6, (0, 220, 255), -1)
            cv2.putText(frame, str(i + 1), (x + 10, y - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 220, 255), 2)
            if i > 0:
                cv2.line(frame, points[i - 1], (x, y), (0, 220, 255), 2)
        if len(points) == 4:
            cv2.line(frame, points[3], points[0], (0, 220, 255), 2)

        prompt = (
            f"Click the {LABELS[len(points)]} corner"
            if len(points) < 4
            else "Enter to accept, u to undo, Esc to cancel"
        )
        cv2.rectangle(frame, (0, 0), (frame.shape[1], 34), (0, 0, 0), -1)
        cv2.putText(frame, prompt, (12, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                    (255, 255, 255), 1, cv2.LINE_AA)
        cv2.imshow(window, frame)

    def on_mouse(event, x, y, _flags, _param):
        if event == cv2.EVENT_LBUTTONDOWN and len(points) < 4:
            points.append((x, y))
            redraw()

    cv2.namedWindow(window)
    cv2.setMouseCallback(window, on_mouse)
    redraw()

    while True:
        key = cv2.waitKey(20) & 0xFF
        if key == 27:  # Esc
            cv2.destroyAllWindows()
            return None
        if key in (ord("u"), 8) and points:
            points.pop()
            redraw()
        if key in (13, 10) and len(points) == 4:
            cv2.destroyAllWindows()
            return points


def preview(spaces, matrix):
    """Render the rectified map so the result can be judged before saving."""
    import numpy as np

    canvas_w, canvas_h = 700, 700
    canvas = np.full((canvas_h, canvas_w, 3), 22, dtype=np.uint8)

    warped = [
        homography.warp_many(s.contour, matrix) for s in spaces
    ]
    flat = [p for poly in warped for p in poly]
    fit = homography.fit_transform(flat)

    for poly in warped:
        pts = np.array(
            [[int(fit(p)[0] * canvas_w), int(fit(p)[1] * canvas_h)] for p in poly],
            np.int32,
        ).reshape(-1, 1, 2)
        cv2.polylines(canvas, [pts], True, (90, 210, 120), 2)

    spread, verdict = homography.quality([[fit(p) for p in poly] for poly in warped])
    cv2.putText(canvas, f"spread {spread:.1f}  {verdict}", (14, canvas_h - 16),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 220, 220), 1, cv2.LINE_AA)

    cv2.imshow("Rectified preview  (Enter to save, Esc to discard)", canvas)
    key = cv2.waitKey(0) & 0xFF
    cv2.destroyAllWindows()
    return key in (13, 10), spread, verdict


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", default="UFPR04")
    ap.add_argument("--points", nargs=4, default=None,
                    help="skip the window: x,y x,y x,y x,y clockwise from top left")
    ap.add_argument("--no-preview", action="store_true")
    ap.add_argument("--auto", action="store_true",
                    help="derive the calibration from the stall annotations")
    args = ap.parse_args()

    dirs = pklot.camera_dirs(DATA, args.camera)
    if not dirs:
        sys.exit(f"No camera {args.camera} under {DATA}")

    jpg, xml = next(pklot.iter_frames(dirs[0]))
    image = cv2.imread(str(jpg))
    height, width = image.shape[:2]
    spaces = pklot.parse_spaces(xml)
    print(f"frame  : {jpg.name}  ({width}x{height}, {len(spaces)} stalls)")

    if args.auto:
        matrix, spread, how = homography.auto_calibrate(spaces)
        if matrix is None:
            sys.exit(f"auto calibration failed: {how}")
        print(f"auto   : derived from {how}")
        points = None
    elif args.points:
        points = [tuple(int(v) for v in p.split(",")) for p in args.points]
    else:
        points = pick_points(image)
        if points is None:
            print("cancelled, nothing written")
            return 1

    if points is not None:
        print("points :", points)
        matrix = homography.compute(points)

    warped = [homography.warp_many(s.contour, matrix) for s in spaces]
    flat = [p for poly in warped for p in poly]
    fit = homography.fit_transform(flat)
    spread, verdict = homography.quality([[fit(p) for p in poly] for poly in warped])
    print(f"quality: spread {spread:.2f}  {verdict}")

    if not args.no_preview and not args.points and not args.auto:
        accepted, spread, verdict = preview(spaces, matrix)
        if not accepted:
            print("discarded, nothing written")
            return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "camera_id": args.camera,
        "image_size": [width, height],
        "points": [list(p) for p in points] if points else None,
        "derived_from": how if args.auto else "manual clicks",
        "matrix": matrix,
        "quality_spread": round(spread, 3),
    }, indent=2) + "\n")
    print(f"saved  : {OUT.relative_to(REPO)}")
    print("run.py will pick this up on next start.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
