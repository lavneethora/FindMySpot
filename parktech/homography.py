"""Turn a camera view into a true overhead map.

The camera looks across the lot at an angle, so stalls further away appear
smaller and the whole scene is a trapezoid. A homography is the 3x3 transform
that undoes that, mapping the ground plane in the image to a flat overhead
plane.

This is what makes the top-down view a real map rather than a redrawn copy of
the camera angle, and it is the answer to the question every judge with any
industry exposure will ask: "so you hand annotated every stall?" No. Four clicks
calibrate a camera, and the transform handles whatever angle it happens to be
mounted at.

Calibration needs four points that form a rectangle **on the ground in real
life**, clicked in the image. Stall corners, a kerb, painted lines. They must be
coplanar: a point on a roof or a light pole top will produce a warp that fans
out instead of squaring up.
"""

import cv2
import numpy as np

# Where the clicked quad lands in the output. Margin so neighbouring stalls that
# fall outside the calibration rectangle still have somewhere to go.
TARGET = np.array(
    [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]], dtype=np.float32
)


def compute(image_points, target=None):
    """Four image points (clockwise from top left) -> 3x3 matrix as a list."""
    src = np.array(image_points, dtype=np.float32)
    if src.shape != (4, 2):
        raise ValueError(f"need exactly 4 points, got {src.shape}")
    dst = np.array(target if target is not None else TARGET, dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(src, dst)
    return matrix.tolist()


def warp(point, matrix):
    """Apply the transform to one (x, y). Returns a normalized coordinate."""
    x, y = point
    denom = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2]
    if abs(denom) < 1e-9:
        return None
    return (
        (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denom,
        (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denom,
    )


def warp_many(points, matrix):
    out = []
    for p in points:
        w = warp(p, matrix)
        if w is not None:
            out.append(w)
    return out


def fit_transform(all_points, margin=0.04):
    """Build a rescale that puts every warped point inside 0..1.

    Four clicks will rarely enclose every stall, so some warp outside the target
    rectangle, and the contract requires 0..1. Rather than clamping, which would
    pile stalls up on the edges and lie about the geometry, fit the whole set to
    the unit square. Relative positions are preserved, which is all the map
    needs to be truthful.

    Returns a callable, so the same fit applies to stalls and to live vehicles.
    """
    xs = [p[0] for p in all_points]
    ys = [p[1] for p in all_points]
    if not xs or not ys:
        return lambda p: p

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max_x - min_x or 1.0
    span_y = max_y - min_y or 1.0
    usable = 1.0 - 2 * margin

    def apply(point):
        return (
            margin + (point[0] - min_x) / span_x * usable,
            margin + (point[1] - min_y) / span_y * usable,
        )

    return apply


def auto_calibrate(spaces, min_separation=250, max_row_offset=40):
    """Derive a calibration from the stall annotations, no clicking needed.

    A parking stall is a rectangle on the ground in real life, so its four
    annotated corners are already a valid calibration quad. One stall alone
    gives a short baseline and amplifies small annotation errors across the
    lot, so prefer two stalls in the same row: their outer corners span a much
    longer baseline and condition the transform far better.

    Searches candidate pairs and keeps whichever scores best under `quality`.
    Returns (matrix, spread, description), or (None, None, reason) if nothing
    scored acceptably.

    This is the dataset path. A camera with no annotations still needs the four
    clicks in calibrate.py, which is the real deployment story.
    """
    if len(spaces) < 2:
        return None, None, "need at least two annotated stalls"

    def centroid(space):
        xs = [p[0] for p in space.contour]
        ys = [p[1] for p in space.contour]
        return sum(xs) / len(xs), sum(ys) / len(ys)

    candidates = []
    for a in spaces:
        ax, ay = centroid(a)
        for b in spaces:
            if a.id >= b.id:
                continue
            bx, by = centroid(b)
            # Same row, far apart: a long baseline along one ground direction.
            if abs(ay - by) > max_row_offset or abs(ax - bx) < min_separation:
                continue
            left, right = (a, b) if ax < bx else (b, a)
            quad = [
                left.contour[0], right.contour[1],
                right.contour[2], left.contour[3],
            ]
            try:
                matrix = compute(quad)
            except (ValueError, cv2.error):
                # Degenerate quad, for example a stall annotated as a sliver.
                # Nothing to log: the search simply moves on to the next pair.
                continue
            warped = [warp_many(s.contour, matrix) for s in spaces]
            flat = [p for poly in warped for p in poly]
            if not flat:
                continue
            fit = fit_transform(flat)
            spread, _ = quality([[fit(p) for p in poly] for poly in warped])
            candidates.append((spread, left.id, right.id, matrix))

    if not candidates:
        return None, None, "no suitable stall pair found"

    candidates.sort(key=lambda c: c[0])
    spread, left_id, right_id, matrix = candidates[0]
    return matrix, spread, f"stalls {left_id} and {right_id}"


def quality(warped_polygons):
    """Rough check that the warp squared the lot up instead of fanning it out.

    Compares stall areas after warping. On a true overhead view every stall is
    roughly the same size, because they are in reality. A big spread means the
    clicked points were not coplanar, which is the common calibration mistake
    and is much easier to catch here than by squinting at the map.

    Returns (ratio, verdict). Ratio near 1 is good.
    """
    areas = []
    for poly in warped_polygons:
        if len(poly) < 3:
            continue
        # shoelace
        area = 0.0
        for i in range(len(poly)):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % len(poly)]
            area += x1 * y2 - x2 * y1
        areas.append(abs(area) / 2.0)

    areas = [a for a in areas if a > 0]
    if len(areas) < 2:
        return 1.0, "too few stalls to judge"

    areas.sort()
    median = areas[len(areas) // 2]
    spread = areas[-1] / median if median else 999

    if spread < 2.5:
        verdict = "good: stall sizes are consistent"
    elif spread < 5:
        verdict = "usable, but the far stalls are still stretched"
    else:
        verdict = "bad: clicked points were probably not on one flat plane"
    return spread, verdict
