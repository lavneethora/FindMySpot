"""Routing along the lot's driving lanes.

A route has to be drivable. The earlier version drew entrance, nearest aisle,
stall, which produced diagonals straight across parked cars and grass. Cars
cannot do that.

So the lanes are a graph and this is a shortest path over it. Every edge is a
real lane, which means every segment of a route is a real lane by construction;
there is no way for a diagonal to appear. The only non-lane movement is the last
hop from the aisle onto the stall itself, which is the car turning in, and that
is drawn perpendicular to the aisle rather than at whatever angle the geometry
happens to give.
"""

import heapq
import math
from itertools import pairwise


def _distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def build_graph(aisles):
    """{node: [(neighbour, cost), ...]} from the layout's lane network."""
    nodes = aisles.get("nodes", {})
    graph = {name: [] for name in nodes}
    for a, b in aisles.get("edges", []):
        if a in nodes and b in nodes:
            cost = _distance(nodes[a], nodes[b])
            graph[a].append((b, cost))
            graph[b].append((a, cost))
    return graph, nodes


def shortest_path(graph, nodes, start, goal):
    """Node names from start to goal, or [] when unreachable."""
    if start not in graph or goal not in graph:
        return []
    if start == goal:
        return [start]

    queue = [(0.0, start)]
    best = {start: 0.0}
    came_from = {}
    seen = set()

    while queue:
        cost, node = heapq.heappop(queue)
        if node in seen:
            continue
        seen.add(node)
        if node == goal:
            break
        for neighbour, step in graph[node]:
            candidate = cost + step
            if candidate < best.get(neighbour, float("inf")):
                best[neighbour] = candidate
                came_from[neighbour] = node
                heapq.heappush(queue, (candidate, neighbour))

    if goal not in came_from and goal != start:
        return []

    path, node = [goal], goal
    while node != start:
        node = came_from[node]
        path.append(node)
    return list(reversed(path))


def nearest_node(nodes, point, prefix=None):
    """Closest lane node to a point, optionally restricted by name prefix."""
    candidates = [
        (name, pos) for name, pos in nodes.items()
        if prefix is None or name.startswith(prefix)
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda item: _distance(item[1], point))[0]


def route_to_stall(layout, spot_id, start_node="entrance"):
    """Lane-following route from a lane node to a stall.

    Returns a list of [x, y] points. The final hop leaves the aisle at the
    stall's own x, so the turn into the bay is perpendicular to the aisle
    rather than a diagonal across it.
    """
    spots = layout.get("spots", {})
    spot = spots.get(spot_id)
    if not spot:
        return []

    graph, nodes = build_graph(layout.get("aisles", {}))
    if not nodes:
        return []

    centroid = spot.get("centroid") or [0.5, 0.5]

    if start_node not in nodes:
        start_node = nearest_node(nodes, nodes.get("entrance", centroid)) or ""

    # A stall can only be entered from an aisle that touches its own row.
    # Without this a driver was routed along the bottom aisle and then straight
    # up through the row below, which is a shorter line and not a drivable one.
    #
    # Gap i lies between row i and row i+1, so row r is served by gap r-1 above
    # it and gap r below it, whichever of those the lot actually paved.
    row = spot.get("row")
    if row is None:
        approach = set(nodes)
    else:
        allowed = {str(row - 1), str(row)}
        approach = {
            name for name in nodes
            if name[:1] in ("L", "R") and name[1:] in allowed
        }
        if not approach:
            approach = set(nodes)

    # Of those, leave from whichever makes the whole trip shortest, counting the
    # drive along the aisle. Picking the one nearest the stall instead sent a
    # driver entering on the left all the way to the right hand lane and back.
    best_names, best_cost = None, float("inf")
    for name, position in nodes.items():
        if name not in approach:
            continue
        names = shortest_path(graph, nodes, start_node, name)
        if not names:
            continue
        cost = sum(
            _distance(nodes[a], nodes[b]) for a, b in pairwise(names)
        )
        # Along the aisle to the stall's column, then into the bay.
        cost += abs(position[0] - centroid[0]) + abs(position[1] - centroid[1])
        if cost < best_cost:
            best_names, best_cost = names, cost

    if not best_names:
        return []

    path = [list(nodes[name]) for name in best_names]

    # Turn in: run along the aisle to the stall's x, then straight into the bay.
    aisle_y = path[-1][1]
    turn = [centroid[0], aisle_y]
    if _distance(path[-1], turn) > 1e-6:
        path.append(turn)
    path.append([centroid[0], centroid[1]])
    return [[round(x, 4), round(y, 4)] for x, y in path]


# Where the demo puts cars that are already circling the lot. Fractions along
# the lane they sit on, so they land in an aisle rather than on top of a stall.
DRIVER_SPOTS = (
    ("L0", "R0", 0.30),
    ("R2", "L2", 0.25),
    ("TL", "TR", 0.55),
)


def simulated_drivers(layout):
    """A few cars already in the lot, sitting on lanes.

    Routing one driver to a stall proves the path is drivable. Routing several
    from different corners to the SAME stall is what makes the lane network
    legible: every path bends around the rows, because none of them can cross
    one.

    Each car is placed along a real lane, so the route from it starts on the
    network rather than teleporting onto it.
    """
    nodes = layout.get("aisles", {}).get("nodes", {})
    drivers = []
    for index, (start, end, fraction) in enumerate(DRIVER_SPOTS, start=1):
        if start not in nodes or end not in nodes:
            continue
        ax, ay = nodes[start]
        bx, by = nodes[end]
        drivers.append({
            "id": index,
            "x": round(ax + (bx - ax) * fraction, 4),
            "y": round(ay + (by - ay) * fraction, 4),
            # The lane this car is sitting on. A route joins it at whichever
            # end is closer to where the car is going.
            "node": start,
            "lane": [start, end],
        })
    return drivers


def route_from_driver(layout, driver, spot_id):
    """Route from a car's own position on its lane.

    The car sits partway along a lane with a junction at either end, so it can
    set off in either direction. Routing from one fixed end made a car drive
    back to that junction first and then past itself, which is a detour no
    driver would make.

    Both ends are tried and the shorter total wins, counting the drive from the
    car to that end.
    """
    here = [driver["x"], driver["y"]]
    lane = driver.get("lane") or [driver.get("node", "entrance")]
    nodes = layout.get("aisles", {}).get("nodes", {})

    best, best_cost = [], float("inf")
    for end in lane:
        if end not in nodes:
            continue
        path = route_to_stall(layout, spot_id, end)
        if not path:
            continue
        # Drive to that end of the lane, then follow the route from it.
        cost = _distance(here, nodes[end]) + sum(
            _distance(path[i], path[i + 1]) for i in range(len(path) - 1)
        )
        if cost < best_cost:
            best, best_cost = path, cost

    if not best:
        return []
    if _distance(here, best[0]) > 1e-6:
        return [here, *best]
    return best
