"""Build the top-down layout the frontend renders.

The live pipeline and the layout must agree on spot ids, or the twin renders
geometry for stalls the state never mentions and shows nothing. So the layout
is derived from the same annotations the occupancy engine uses, never from a
separate fixture.

Right now stall polygons are the camera's own contours normalized to 0..1. That
is camera space, not a true overhead view, so the twin currently inherits the
camera's perspective. The homography step replaces `project` with a real ground
plane warp; nothing else here changes, and the contract does not change at all.
"""

import math

# Where cars enter, in normalized coordinates. Bottom centre of frame is a
# reasonable default for a camera looking across a lot from one end.
DEFAULT_ENTRANCE = {"x": 0.5, "y": 0.98}

# Rough physical size of the monitored area, used only to turn normalized
# distances into metres for display and for ranking the best stall.
LOT_WIDTH_M = 60.0
LOT_DEPTH_M = 40.0


def project(point, size, homography=None):
    """Camera pixel -> normalized top-down coordinate.

    With no homography this is a plain normalize, which keeps the camera's
    perspective. With one it becomes a real overhead projection.
    """
    width, height = size
    if homography is None:
        return (point[0] / width, point[1] / height)

    x, y = point
    denom = homography[2][0] * x + homography[2][1] * y + homography[2][2]
    if abs(denom) < 1e-9:
        return (point[0] / width, point[1] / height)
    wx = (homography[0][0] * x + homography[0][1] * y + homography[0][2]) / denom
    wy = (homography[1][0] * x + homography[1][1] * y + homography[1][2]) / denom
    return (wx, wy)


def from_spaces(spaces, image_size, camera_id, lot_name=None,
                entrance=None, homography=None):
    """Produce a layout dict valid against contracts/layout.schema.json."""
    entrance = entrance or dict(DEFAULT_ENTRANCE)
    spots = {}

    for space in spaces:
        polygon = [
            [round(x, 4), round(y, 4)]
            for x, y in (
                project(p, image_size, homography) for p in space.contour
            )
        ]
        cx = sum(p[0] for p in polygon) / len(polygon)
        cy = sum(p[1] for p in polygon) / len(polygon)

        dx = (cx - entrance["x"]) * LOT_WIDTH_M
        dy = (cy - entrance["y"]) * LOT_DEPTH_M
        spots[space.id] = {
            "polygon": polygon,
            "centroid": [round(cx, 4), round(cy, 4)],
            "distance_to_entrance_m": round(math.hypot(dx, dy), 1),
        }

    return {
        "camera_id": camera_id,
        "lot_name": lot_name or camera_id,
        "entrance": entrance,
        "spots": spots,
        "aisles": _aisles(spots, entrance),
    }


def _aisles(spots, entrance):
    """A small waypoint graph so routes run along aisles, not across cars.

    Deliberately crude: one node at the middle of the lot plus one per row band.
    Enough for a route that reads correctly on the map, and cheap to replace
    once the rectified geometry makes real aisle detection possible.
    """
    if not spots:
        return {"nodes": {}, "edges": []}

    ys = sorted(s["centroid"][1] for s in spots.values())
    mid_y = ys[len(ys) // 2]

    nodes = {
        "entrance": [entrance["x"], entrance["y"]],
        "main": [0.5, round(mid_y, 4)],
    }
    edges = [["entrance", "main"]]

    # One aisle node per side, so a route bends toward the correct half.
    for name, x in (("aisle_l", 0.15), ("aisle_r", 0.85)):
        nodes[name] = [x, round(mid_y, 4)]
        edges.append(["main", name])

    return {"nodes": nodes, "edges": edges}
