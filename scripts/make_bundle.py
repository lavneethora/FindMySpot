"""Carve out the slice of the dataset a deployed pipeline actually replays.

The full PKLot download is 6.6 GB. A deployed demo replays a few hundred frames
of one camera, and the detections for those frames are already precomputed. So
the server needs the frames, their annotations, and the cache. Nothing else.

    python scripts/make_bundle.py --out ../findmyspot-bundle

Produces a directory that runs on its own:

    findmyspot-bundle/
      parktech/        the package
      scripts/         precompute and validation, for rebuilding a cache
      config/          row grouping
      contracts/       schemas, used by the validator
      run.py
      data/cache/      precomputed detections
      data/PKLot/...   only the frames in the cache
      requirements-server.txt
      Dockerfile

Frames come from the cache rather than from a count, so the bundle and the
cache can never disagree. A frame the cache does not cover would send the
server to YOLO, which is not installed there.
"""

import argparse
import json
import lzma
import pathlib
import shutil
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

CACHE_DIR = REPO / "data" / "cache"


def find_cache(camera):
    matches = sorted(CACHE_DIR.glob(f"{camera}-*.json.xz"))
    if not matches:
        sys.exit(
            f"No cache for {camera} in {CACHE_DIR}.\n"
            "Run scripts/precompute.py first: a bundle without one would need "
            "torch on the server, which is the thing this avoids."
        )
    return matches[-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", default="PUCPR")
    ap.add_argument("--out", default="../findmyspot-bundle")
    args = ap.parse_args()

    out = pathlib.Path(args.out).expanduser().resolve()
    if out.exists():
        shutil.rmtree(out)

    cache_file = find_cache(args.camera)
    cache = json.loads(lzma.open(cache_file, "rt").read())
    wanted = set(cache["frames"])
    print(f"cache : {cache_file.name}")
    print(f"        {len(wanted)} frames, {cache['model']} @{cache['imgsz']}")

    # Code, config and contracts.
    for rel in ("parktech", "scripts", "config", "contracts"):
        shutil.copytree(REPO / rel, out / rel,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copy2(REPO / "run.py", out / "run.py")
    shutil.copy2(REPO / "deploy" / "requirements-server.txt", out / "requirements-server.txt")
    shutil.copy2(REPO / "deploy" / "Dockerfile", out / "Dockerfile")
    shutil.copy2(REPO / "deploy" / ".dockerignore", out / ".dockerignore")

    # The cache itself.
    (out / "data" / "cache").mkdir(parents=True)
    shutil.copy2(cache_file, out / "data" / "cache" / cache_file.name)

    # Only the frames the cache covers, keeping the directory shape the loader
    # expects: data/PKLot/PKLot/<CAMERA>/<weather>/<day>/
    copied = 0
    total_bytes = 0
    for jpg in (REPO / "data" / "PKLot").rglob("*.jpg"):
        if jpg.name not in wanted or "Segmented" in str(jpg):
            continue
        xml = jpg.with_suffix(".xml")
        if not xml.exists():
            continue
        target = out / jpg.relative_to(REPO)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(jpg, target)
        shutil.copy2(xml, target.with_suffix(".xml"))
        copied += 1
        total_bytes += jpg.stat().st_size + xml.stat().st_size

    missing = len(wanted) - copied
    print(f"frames: {copied} copied, {total_bytes / 1e6:.0f} MB")
    if missing:
        print(f"WARNING: {missing} cached frames had no file on disk. The server "
              "would try to run YOLO for those and fail.")

    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"bundle: {out}  ({size / 1e6:.0f} MB total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
