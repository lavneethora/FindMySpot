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

import numpy as np

# A stall is about twice as deep as it is wide. Keeps the map readable at a
# glance instead of looking like a bar chart.
STALL_ASPECT = 2.0

# Smallest separation drawn between two rows, in normalized units. Stops rows
# fusing together when their annotation polygons overlap.
MIN_ROW_GAP = 0.022

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


def build(spaces, margin=0.06, row_spec=None):
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

    # One stall width for the whole lot, chosen so that no row overflows the
    # horizontal footprint it really occupies. Taking the tightest row keeps
    # every other row comfortably inside its own span.
    stall_w = usable
    for row in rows:
        row_pts = [p for s in row for p in s.contour]
        row_span = norm_x(max(p[0] for p in row_pts)) - norm_x(min(p[0] for p in row_pts))
        stall_w = min(stall_w, row_span / len(row))

    # Rows are stacked by the real gap between their EDGES, not between their
    # centres. Centre spacing includes the depth of the stalls themselves, so
    # using it made an 8px grass strip render as a huge band. Stall height is
    # the median real depth, which keeps stalls uniform while the gaps between
    # rows stay proportional to the lot.
    row_top = [norm_y(min(p[1] for s in row for p in s.contour)) for row in rows]
    row_bot = [norm_y(max(p[1] for s in row for p in s.contour)) for row in rows]
    stall_h = float(np.median([b - t for t, b in zip(row_top, row_bot)]))
    edge_gaps = [max(0.0, t - b) for b, t in zip(row_bot, row_top[1:])]

    # Adjacent rows can have overlapping annotation polygons even where there
    # is physically a grass strip between them, because the stalls are traced
    # generously. Computing the gap from polygon edges then reports zero and
    # the map shows two rows fused together. Keep a floor so a real separation
    # stays visible.
    edge_gaps = [max(g, MIN_ROW_GAP) for g in edge_gaps]

    # Restack from the first row's real top, so every gap is the true one.
    tops = [row_top[0]]
    for gap in edge_gaps:
        tops.append(tops[-1] + stall_h + gap)

    # If uniform depth pushed the block past the canvas, scale the whole stack
    # back into range rather than clipping the last row off the map.
    overflow = (tops[-1] + stall_h) - (1.0 - margin)
    if overflow > 0:
        shrink = (1.0 - 2 * margin) / (tops[-1] + stall_h - tops[0])
        stall_h *= shrink
        tops = [margin + (t - tops[0]) * shrink for t in tops]

    layout = {}
    for r, row in enumerate(rows):
        row_pts = [p for s in row for p in s.contour]
        left = norm_x(min(p[0] for p in row_pts))
        y0 = tops[r]
        y1 = y0 + stall_h
        for i, space in enumerate(row):
            x0 = left + i * stall_w
            x1 = x0 + stall_w
            pad = stall_w * 0.07
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
    layout, rows = build(spaces, row_spec=row_spec)
    if not layout:
        return {}

    drivable = set(drivable_gaps or [])

    # Entrance sits below the lot, centred on the nearest row.
    last_row = rows[-1]
    entrance = {
        "x": round(float(np.mean([layout[s.id]["centroid"][0] for s in last_row])), 4),
        "y": 0.98,
    }

    nodes = {"entrance": [entrance["x"], entrance["y"]]}
    edges = []
    previous = "entrance"
    for gap_index in sorted(drivable):
        if gap_index + 1 >= len(rows):
            continue
        above = max(layout[s.id]["polygon"][2][1] for s in rows[gap_index])
        below = min(layout[s.id]["polygon"][0][1] for s in rows[gap_index + 1])
        name = f"aisle_{gap_index}"
        nodes[name] = [0.5, round((above + below) / 2, 4)]
        edges.append([previous, name])
        previous = name

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
