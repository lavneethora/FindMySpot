"""Read PKLot annotations.

Each full-frame .jpg has a sibling .xml of the form:

    <parking id="ufpr04">
      <space id="1" occupied="1">
        <rotatedRect> <center x y/> <size w h/> <angle d/> </rotatedRect>
        <contour> <point x y/> x4 </contour>
      </space>
      ...

The contour is what we want: a 4 point polygon per space, in image pixels, for a
fixed camera. That is why this dataset was chosen. The polygons come free, and
the occupied attribute gives ground truth to measure against rather than assert.

Note that `occupied` is missing on a small number of spaces in the dataset. Those
are returned with occupied=None and should be excluded from accuracy scoring
rather than guessed at.
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

CAMERAS = ("UFPR04", "UFPR05", "PUCPR")


@dataclass(frozen=True)
class Space:
    id: str
    contour: tuple  # ((x, y), (x, y), (x, y), (x, y)) in image pixels
    occupied: bool | None  # ground truth, None when the dataset omits it


def parse_spaces(xml_path):
    """Return the annotated spaces for one frame, ordered by id."""
    root = ET.parse(xml_path).getroot()
    spaces = []
    for el in root.findall(".//space"):
        points = [
            (int(p.get("x")), int(p.get("y")))
            for p in el.findall("./contour/point")
        ]
        if len(points) < 3:
            continue  # degenerate annotation, nothing to test a point against
        raw = el.get("occupied")
        spaces.append(
            Space(
                id=el.get("id"),
                contour=tuple(points),
                occupied=None if raw is None else raw == "1",
            )
        )
    return spaces


def camera_dirs(data_root, camera=None):
    """Resolve camera directories under the extracted dataset.

    The tarball nests as PKLot/PKLot/<CAMERA>, and PKLotSegmented holds per-space
    crops we never want, so match by directory name instead of a fixed depth.
    """
    data_root = Path(data_root)
    wanted = {camera} if camera else set(CAMERAS)
    return sorted(
        p for p in data_root.rglob("*")
        if p.is_dir() and p.name in wanted and "Segmented" not in str(p)
    )


def iter_frames(camera_dir, day=None):
    """Yield (jpg, xml) pairs in chronological order.

    A fixed camera plus chronologically ordered frames is what lets us treat a
    day of stills as a time lapse: the space polygons never move between frames.
    """
    root = Path(camera_dir)
    if day:
        roots = [p for p in root.rglob(day) if p.is_dir()] or [root / day]
    else:
        roots = [root]
    for r in roots:
        for jpg in sorted(r.rglob("*.jpg")):
            xml = jpg.with_suffix(".xml")
            if xml.exists():
                yield jpg, xml


def days(camera_dir):
    """Available capture days for a camera, as directory names."""
    root = Path(camera_dir)
    found = {
        p.parent.name
        for p in root.rglob("*.xml")
    }
    return sorted(found)
