"""Decide whether each annotated space holds a vehicle.

The test is deliberately simple: take the bottom centre of each detection box,
which is roughly where the tyres meet the ground, and ask which space polygon
contains it. For a perspective view this beats IoU, because a car's box overlaps
several neighbouring polygons while its contact patch sits in exactly one.

Debouncing lives here too. A detector that drops a car for a single frame would
otherwise make a spot strobe red and green, which reads as broken in a demo.
"""

import cv2
import numpy as np

# Frames of agreement required before a state change is published.
# Asymmetric on purpose: showing a spot as free when it is not is the costly
# error, so freeing a spot takes more evidence than filling it.
OCCUPY_AFTER = 3
FREE_AFTER = 5


def bottom_centre(box):
    """(x1, y1, x2, y2) -> the point where the vehicle meets the ground."""
    x1, _, x2, y2 = box
    return ((x1 + x2) / 2.0, y2)


def assign(spaces, points):
    """Ground point in polygon. Map space id -> True when a detection sits in it.

    Works when stalls are square to the camera. Measured poorly on PKLot's angled
    stalls, because an axis aligned box around a diagonally parked car puts its
    bottom centre outside the stall. Kept for comparison; prefer assign_overlap.
    """
    polygons = {
        s.id: np.array(s.contour, dtype=np.int32).reshape(-1, 1, 2)
        for s in spaces
    }
    result = {sid: False for sid in polygons}
    for px, py in points:
        for sid, poly in polygons.items():
            if result[sid]:
                continue  # already claimed, no need to test again
            if cv2.pointPolygonTest(poly, (float(px), float(py)), False) >= 0:
                result[sid] = True
                break  # one car occupies one space
    return result


def assign_centroid_in_box(spaces, boxes):
    """Inverse test: is the stall's centre covered by any detection box?

    Robust to angled stalls, because it never asks where in the box the car
    actually sits. Weak where boxes are large and overlap neighbouring stalls.
    """
    result = {}
    for s in spaces:
        cx = sum(p[0] for p in s.contour) / len(s.contour)
        cy = sum(p[1] for p in s.contour) / len(s.contour)
        result[s.id] = any(
            x1 <= cx <= x2 and y1 <= cy <= y2 for x1, y1, x2, y2 in boxes
        )
    return result


def assign_overlap(spaces, boxes, threshold=0.35):
    """Fraction of the stall polygon covered by a detection box.

    Handles rotated stalls properly: intersects the real polygon with each box
    rather than reducing either to a point. The threshold is what stops a car in
    an adjacent stall from claiming this one.
    """
    result = {}
    for s in spaces:
        poly = np.array(s.contour, dtype=np.float32)
        poly_area = abs(cv2.contourArea(poly))
        if poly_area <= 0:
            result[s.id] = False
            continue

        best = 0.0
        for x1, y1, x2, y2 in boxes:
            rect = np.array(
                [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype=np.float32
            )
            inter_area, _ = cv2.intersectConvexConvex(poly, rect)
            best = max(best, inter_area / poly_area)
        result[s.id] = best >= threshold
    return result


class Debouncer:
    """Smooth per-space state so a single missed detection cannot flip a spot."""

    def __init__(self, occupy_after=OCCUPY_AFTER, free_after=FREE_AFTER):
        self.occupy_after = occupy_after
        self.free_after = free_after
        self._state = {}
        self._streak = {}

    def update(self, raw):
        """Feed one frame of raw booleans, get back the published state.

        Returns (state, changes) where changes lists (space_id, from, to) for
        spaces that actually flipped on this frame. Those are the only things
        worth writing to the database or pushing over the socket.
        """
        changes = []
        for sid, is_occupied in raw.items():
            if sid not in self._state:
                # Seed from the first observation rather than assuming empty,
                # otherwise every occupied spot reports a spurious change.
                self._state[sid] = is_occupied
                self._streak[sid] = 0
                continue

            if is_occupied == self._state[sid]:
                self._streak[sid] = 0
                continue

            self._streak[sid] += 1
            needed = self.occupy_after if is_occupied else self.free_after
            if self._streak[sid] >= needed:
                was = self._state[sid]
                self._state[sid] = is_occupied
                self._streak[sid] = 0
                changes.append((sid, was, is_occupied))

        return dict(self._state), changes

    @property
    def state(self):
        return dict(self._state)
