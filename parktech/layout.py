"""Build the top-down layout the frontend renders.

The live pipeline and the layout must agree on spot ids, or the twin renders
geometry for stalls the state never mentions and shows nothing. So the layout is
derived from the same annotations the occupancy engine uses, never from a
separate fixture.

With config/homography.json present, stall polygons are a true overhead
projection of the ground plane. Without it they fall back to a plain normalize,
which keeps the camera's perspective and looks tilted. Either way the contract
is identical, so the frontend never knows the difference.
"""

import math

from parktech import homography as homography_mod

# Where cars enter, in normalized coordinates. Bottom centre is a reasonable
# default for a camera looking across a lot from one end.
DEFAULT_ENTRANCE = {"x": 0.5, "y": 0.98}

# Rough physical size of the monitored area, used only to turn normalized
# distances into metres for display and for ranking the best stall.
LOT_WIDTH_M = 60.0
LOT_DEPTH_M = 40.0


def make_projector(spaces, image_size, matrix=None):
    """Return pixel -> normalized 0..1, consistent for stalls and vehicles.

    Both must go through the same function. If stalls were fitted one way and
    live cars another, vehicles would drift off their stalls on the map, which
    looks exactly like a tracking bug and is not one.
    """
    width, height = image_size

    if matrix is None:
        def projector(point):
            return (point[0] / width, point[1] / height)
        return projector

    # Four clicks rarely enclose every stall, so some warp outside the target
    # rectangle. Fit the whole set into the unit square rather than clamping,
    # which would pile stalls onto the edges and misrepresent the geometry.
    warped = [
        p
        for space in spaces
        for p in homography_mod.warp_many(space.contour, matrix)
    ]
    fit = homography_mod.fit_transform(warped)

    def projector(point):
        w = homography_mod.warp(point, matrix)
        if w is None:
            return (point[0] / width, point[1] / height)
        return fit(w)

    return projector


def from_spaces(spaces, image_size, camera_id, lot_name=None,
                entrance=None, matrix=None, projector=None):
    """Produce a layout dict valid against contracts/layout.schema.json."""
    entrance = entrance or dict(DEFAULT_ENTRANCE)
    projector = projector or make_projector(spaces, image_size, matrix)
    spots = {}

    for space in spaces:
        polygon = [
            [round(x, 4), round(y, 4)]
            for x, y in (projector(p) for p in space.contour)
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

    Deliberately crude: one node mid lot plus one per side. Enough for a route
    that reads correctly on the map, and cheap to replace once the rectified
    geometry makes real aisle detection worthwhile.
    """
    if not spots:
        return {"nodes": {}, "edges": []}

    ys = sorted(s["centroid"][1] for s in spots.values())
    mid_y = round(ys[len(ys) // 2], 4)

    nodes = {
        "entrance": [entrance["x"], entrance["y"]],
        "main": [0.5, mid_y],
    }
    edges = [["entrance", "main"]]
    for name, x in (("aisle_l", 0.15), ("aisle_r", 0.85)):
        nodes[name] = [x, mid_y]
        edges.append(["main", name])

    return {"nodes": nodes, "edges": edges}
