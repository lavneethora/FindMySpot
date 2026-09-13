"""Precomputed detections, so the demo never waits on a GPU.

yolo11m at 1920px takes about 1.3 seconds a frame on this laptop. That is fine
for measuring accuracy and far too slow to drive a demo: the lot clock crawls,
and a machine running a medium model flat out for an hour at a booth will
thermal throttle and get slower still, right when people are watching.

Detections for a fixed camera replaying fixed frames are deterministic, so
there is no reason to compute them twice. This stores the boxes per frame once,
and the replay reads them back.

**Nothing about the accuracy claim changes.** These are the same boxes the same
model produced with the same settings; they are simply not being recomputed on
stage. The cache records the model and settings it was built with and refuses to
load against different ones, so a config change can never silently serve stale
detections.
"""

import json
import lzma
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"

# Bumped when the stored shape changes, so an old file is rejected rather than
# misread.
FORMAT_VERSION = 1


def path_for(camera_id, model, imgsz, conf):
    """One cache per camera and detector configuration."""
    stem = f"{camera_id}-{Path(model).stem}-{imgsz}-{conf}".replace(".", "_")
    return CACHE_DIR / f"{stem}.json.xz"


def save(camera_id, model, imgsz, conf, frames):
    """frames: {frame filename: [[x1, y1, x2, y2, confidence], ...]}"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    target = path_for(camera_id, model, imgsz, conf)
    payload = {
        "format": FORMAT_VERSION,
        "camera_id": camera_id,
        "model": model,
        "imgsz": imgsz,
        "conf": conf,
        "frames": frames,
    }
    # Boxes compress extremely well and the file is read once at startup, so
    # trade a little decompression time for a much smaller repo footprint.
    with lzma.open(target, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh)
    return target


def load(camera_id, model, imgsz, conf):
    """Return {frame filename: boxes} or None when there is nothing usable.

    Returns None rather than raising: a missing or mismatched cache should fall
    back to live inference, never stop the demo starting.
    """
    target = path_for(camera_id, model, imgsz, conf)
    if not target.exists():
        return None
    try:
        with lzma.open(target, "rt", encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, lzma.LZMAError, json.JSONDecodeError) as exc:
        print(f"cache: {target.name} unreadable ({exc}), running live")
        return None

    if payload.get("format") != FORMAT_VERSION:
        print(f"cache: {target.name} is format {payload.get('format')}, "
              f"expected {FORMAT_VERSION}. Running live.")
        return None

    # Belt and braces. The filename already encodes these, but a cache serving
    # detections from a different model would quietly invalidate the accuracy
    # number, which is the one claim we cannot afford to be loose about.
    if (payload.get("model") != model
            or payload.get("imgsz") != imgsz
            or payload.get("conf") != conf):
        print(f"cache: {target.name} was built for a different configuration. "
              "Running live.")
        return None

    return payload.get("frames") or None
