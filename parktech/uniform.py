"""Lay the lot out as a clean, uniform map.

The annotated contours are the camera's view of each stall, so they vary in
size and skew with perspective and with how carefully each was traced. Drawing
those directly gives a map that is faithful but reads as wonky, which is not
what a driver wants to look at. Real parking apps draw a tidy schematic.

So: keep the real structure, which rows exist and which stall sits where along
each one, and normalise the drawing. Every stall becomes the same size, evenly
spaced, rows evenly stacked. Positions come from the annotations, proportions
are made uniform.

Row detection is a one dimensional gap split on stall centres rather than
k-means, because parking rows are separated by aisles that show up as clear
gaps, and a gap split cannot invent a row that is not there.
"""

from itertools import pairwise

import numpy as np

# Depth as a multiple of width. A real bay is roughly 2.5m by 5m, but drawing
# that ratio across a 22 stall row makes each one a thin sliver that reads as a
# bar chart rather than somewhere you park a car. Squatter is more legible and
# still unmistakably a parking space.
STALL_ASPECT = 1.35

# Fraction of a stall's width left as a gap to its neighbour. Small, because
# bays are painted next to each other, not spaced out.
STALL_PADDING = 0.04

# Gaps between rows, in normalized units. Real lots are built to a standard:
# every driving aisle is the same width, and every planted median is the same
# width. Taking these from the camera instead makes far aisles look narrower
# than near ones, which is perspective leaking into a map that is supposed to
# have none.
AISLE_GAP = 0.085
GRASS_GAP = 0.030

# Rough physical size of the monitored area, used to turn normalized distances
# into metres for display and for ranking the nearest free stall.
LOT_WIDTH_M = 60.0
LOT_DEPTH_M = 40.0


def centroid(space):
    return (
        float(np.mean([p[0] for p in space.contour])),
        float(np.mean([p[1] for p in space.contour])),
    )


def detect_rows(spaces, reach=1.7):
    """Group stalls into rows by adjacency, not by horizontal bands.

    A band split on vertical position only works when rows are straight and
    stacked, which is true of PUCPR and false of UFPR04, whose stalls fan out
    in a chevron so the two arms overlap vertically. Splitting that on gaps
    produced rows of 23, 1, 1, 1 and 2.

    Adjacency handles both: neighbouring stalls in a row sit roughly one stall
    width apart, wherever that row happens to point. Stalls are linked to their
    near neighbours and each connected component is a row.

    reach is a multiple of the typical nearest-neighbour distance, so it scales
    with the camera instead of needing a pixel threshold per lot.
    """
    if not spaces:
        return []
    if len(spaces) == 1:
        return [list(spaces)]

    pts = np.array([centroid(s) for s in spaces])
    diff = pts[:, None, :] - pts[None, :, :]
    dist = np.sqrt((diff**2).sum(axis=2))
    np.fill_diagonal(dist, np.inf)

    # Typical spacing between neighbouring stalls in the same row.
    nearest = dist.min(axis=1)
    threshold = float(np.median(nearest)) * reach

    # Union find over the adjacency graph.
    parent = list(range(len(spaces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(len(spaces)):
        for j in range(i + 1, len(spaces)):
            if dist[i, j] <= threshold:
                union(i, j)

    groups = {}
    for idx, space in enumerate(spaces):
        groups.setdefault(find(idx), []).append(space)

    rows = list(groups.values())

    # Order stalls along whichever direction the row actually runs, so the map
    # reads left to right the way the lot does rather than assuming horizontal.
    for row in rows:
        if len(row) < 2:
            continue
        coords = np.array([centroid(s) for s in row])
        centred = coords - coords.mean(axis=0)
        direction = np.linalg.svd(centred)[2][0]
        row.sort(key=lambda s: float(np.dot(centroid(s) - coords.mean(axis=0), direction)))

    # Rows nearest the camera bottom first, matching how the lot is read.
    rows.sort(key=lambda r: float(np.mean([centroid(s)[1] for s in r])))
    return rows


def rows_from_config(spaces, spec):
    """Use a hand written row grouping, ignoring any stall it does not name.

    Returns None when the spec does not cover the stalls we actually have, so
    the caller falls back to detection rather than silently dropping stalls
    from the map.
    """
    if not spec:
        return None
    by_id = {s.id: s for s in spaces}
    rows = []
    named = set()
    for row_ids in spec:
        row = [by_id[i] for i in row_ids if i in by_id]
        if row:
            rows.append(row)
            named.update(s.id for s in row)
    missing = set(by_id) - named
    if missing:
        print(f"uniform: row config misses stalls {sorted(missing)}, detecting instead")
        return None
    return rows


def build(spaces, margin=0.06, row_spec=None, drivable_gaps=None):
    """Return {spot_id: {polygon, centroid, row, index}} in 0..1 space.

    Stall sizes are uniform, but row spacing and each row's horizontal offset
    are taken from where the stalls actually are. Evenly stacking the rows
    would erase the real structure: a lot where two rows sit back to back with
    no aisle between them would look identical to one with an aisle, and the
    routing has no way to know where a car can actually drive.
    """
    rows = rows_from_config(spaces, row_spec) or detect_rows(spaces)
    if not rows:
        return {}, []

    usable = 1.0 - 2 * margin
    pts = [p for s in spaces for p in s.contour]
    lot_x0, lot_x1 = min(p[0] for p in pts), max(p[0] for p in pts)
    lot_y0, lot_y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    span_x = (lot_x1 - lot_x0) or 1.0
    span_y = (lot_y1 - lot_y0) or 1.0

    def norm_x(x):
        return margin + (x - lot_x0) / span_x * usable

    def norm_y(y):
        return margin + (y - lot_y0) / span_y * usable

    # One stall width for the whole lot, set by the longest row so that row
    # spans the map. Sizing to the tightest row instead made every stall a
    # sliver: the narrowest row is narrow because its bays are wider, not
    # because the lot is, and honouring that shrank all 100 stalls to suit one
    # row of twelve.
    # Each row starts at its true horizontal offset, so the width a row can use
    # is whatever remains between that offset and the right margin. Take the
    # tightest of those, or a row that starts far right runs off the map.
    right = 1.0 - margin
    stall_w = usable
    for row in rows:
        row_pts = [p for s in row for p in s.contour]
        left = norm_x(min(p[0] for p in row_pts))
        stall_w = min(stall_w, (right - left) / len(row))

    # Rows are stacked by the real gap between their EDGES, not between their
    # Only the first row's real position is needed; everything below it is
    # stacked by fixed aisle and median widths, so the map stops inheriting the
    # camera's foreshortening.
    row_top = [norm_y(min(p[1] for s in row for p in s.contour)) for row in rows]

    # Depth follows the width, not the camera. The annotated depth carries that
    # same foreshortening, which made near rows deep and far rows shallow on a
    # map that is meant to show neither.
    stall_h = stall_w * STALL_ASPECT

    # Every aisle the same width, every median the same width. A lot is built
    # to a standard, and measuring the gaps off the camera reproduced its
    # perspective: the far aisle came out half the width of the near one even
    # though a car needs the same room in both.
    # Gap i sits between row i and row i+1. Index len(rows)-1 means the aisle
    # BELOW the last row, which a lot needs or its bottom row is unreachable.
    drivable = set(drivable_gaps or [])
    edge_gaps = [
        AISLE_GAP if i in drivable else GRASS_GAP
        for i in range(len(rows) - 1)
    ]

    # Restack from the first row's real top, so every gap is the true one.
    tops = [row_top[0]]
    for gap in edge_gaps:
        tops.append(tops[-1] + stall_h + gap)

    # Shrink to fit if the stack overflows, but never stretch to fill. Stalls
    # are drawn to a fixed proportion so they read as parking bays; scaling
    # them vertically to use up spare canvas turns them back into slivers. The
    # frontend fits the viewport to whatever the map actually occupies.
    block = (tops[-1] + stall_h) - tops[0]
    if block > (1.0 - 2 * margin):
        scale = (1.0 - 2 * margin) / block
        stall_h *= scale
        tops = [margin + (t - tops[0]) * scale for t in tops]

    layout = {}
    for r, row in enumerate(rows):
        row_pts = [p for s in row for p in s.contour]
        left = norm_x(min(p[0] for p in row_pts))
        y0 = tops[r]
        y1 = y0 + stall_h
        for i, space in enumerate(row):
            x0 = left + i * stall_w
            x1 = x0 + stall_w
            pad = stall_w * STALL_PADDING
            layout[space.id] = {
                "polygon": [
                    [round(x0 + pad, 4), round(y0, 4)],
                    [round(x1 - pad, 4), round(y0, 4)],
                    [round(x1 - pad, 4), round(y1, 4)],
                    [round(x0 + pad, 4), round(y1, 4)],
                ],
                "centroid": [round((x0 + x1) / 2, 4), round((y0 + y1) / 2, 4)],
                "row": r,
                "index": i,
            }
    return layout, rows


def to_layout(spaces, camera_id, row_spec=None, drivable_gaps=None,
              lot_name=None):
    """Uniform map in the shape contracts/layout.schema.json expects.

    Aisles come from which gaps are actually drivable. Routing through a grass
    median would be worse than drawing no route at all, so rows separated by
    grass get no waypoint between them.
    """
    layout, rows = build(spaces, row_spec=row_spec, drivable_gaps=drivable_gaps)
    if not layout:
        return {}

    drivable = set(drivable_gaps or [])

    # The lane network. Real lots are a grid: aisles run across the lot, and
    # perpendicular lanes run down both sides joining them. Routes travel along
    # those lanes only, which is why a path can never cut diagonally across
    # parked cars.
    #
    #   left lane                            right lane
    #      |                                      |
    #      +---------- aisle (row gap) -----------+
    #      |                                      |
    #      +---------- aisle (row gap) -----------+
    left_x, right_x = 0.030, 0.970

    aisle_ys = []
    for gap_index in sorted(drivable):
        if gap_index + 1 < len(rows):
            above = max(layout[s.id]["polygon"][2][1] for s in rows[gap_index])
            below = min(layout[s.id]["polygon"][0][1] for s in rows[gap_index + 1])
            aisle_ys.append((gap_index, round((above + below) / 2, 4)))
        elif gap_index == len(rows) - 1:
            # An aisle below the bottom row. Without it that row has no road
            # touching it and the map says you cannot park there.
            last = max(layout[s.id]["polygon"][2][1] for s in rows[-1])
            aisle_ys.append((gap_index, round(last + AISLE_GAP / 2, 4)))
    aisle_ys.sort(key=lambda pair: pair[1])

    nodes, edges = {}, []
    for gap_index, y in aisle_ys:
        nodes[f"L{gap_index}"] = [left_x, y]
        nodes[f"R{gap_index}"] = [right_x, y]
        edges.append([f"L{gap_index}", f"R{gap_index}"])

    # Side lanes join consecutive aisles, so the grid is connected and a driver
    # can reach any aisle from any other.
    for (a, _ay), (b, _by) in pairwise(aisle_ys):
        edges.append([f"L{a}", f"L{b}"])
        edges.append([f"R{a}", f"R{b}"])

    # The entrance hangs off the lowest aisle on the left.
    if aisle_ys:
        lowest = aisle_ys[-1][0]
        entrance = {"x": left_x, "y": round(aisle_ys[-1][1] + AISLE_GAP * 0.8, 4)}
        nodes["entrance"] = [entrance["x"], entrance["y"]]
        edges.append(["entrance", f"L{lowest}"])
    else:
        last = max(layout[s.id]["polygon"][2][1] for s in rows[-1])
        entrance = {"x": left_x, "y": round(min(0.98, last + 0.06), 4)}
        nodes["entrance"] = [entrance["x"], entrance["y"]]

    spots = {}
    for spot_id, cell in layout.items():
        cx, cy = cell["centroid"]
        # Straight line distance to the entrance, scaled to the lot's real size.
        dx = (cx - entrance["x"]) * LOT_WIDTH_M
        dy = (cy - entrance["y"]) * LOT_DEPTH_M
        spots[spot_id] = {
            "polygon": cell["polygon"],
            "centroid": cell["centroid"],
            "distance_to_entrance_m": round(float(np.hypot(dx, dy)), 1),
            "row": cell["row"],
            "index": cell["index"],
        }

    return {
        "camera_id": camera_id,
        "lot_name": lot_name or camera_id,
        "entrance": entrance,
        "spots": spots,
        "aisles": {"nodes": nodes, "edges": edges},
        "rows": [[s.id for s in row] for row in rows],
        "drivable_gaps": sorted(drivable),
    }
