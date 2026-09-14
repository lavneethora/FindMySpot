# FindMySpot

A computer-vision layer for parking infrastructure that already exists. It turns an ordinary
fixed camera into a live map of which stalls are open, which one to take, and how the lot gets
used over time.

## The problem

Lots already have capacity and already have cameras. Nobody knows which specific stalls are free
right now, so drivers circle, congest the lot and arrive late. FindMySpot does not add parking.
It makes the parking that already exists observable.

## Two views, deliberately

**Driver view (`/`)** is the product. A top-down map of the lot, green for open and red for
taken. Click a free stall and it draws the way there along the driving lanes.

**No camera feed here, on purpose.** Streaming footage of a car park to every driver would
contradict the one claim the product rests on: that only occupancy state ever leaves the camera.
Detector accuracy is left out for the same reason. It is a number a driver cannot act on and
would only invite doubt.

**Operator view (`/ops`)** is the technical proof. The camera with detections and stall outlines
drawn in, live accuracy against ground truth, the occupancy curve, and the activity feed. This is
the only place footage appears, and the only place accuracy is quoted, because an operator is the
person who would act on it.

## How it works

```
fixed camera frame
      |
YOLO11m @1920px, COCO classes car/bus/truck
      |
occupancy: intersect each detection box with each stall polygon,
           taken when a box covers >=35% of the stall, then debounced
      |
      +-- annotated frame, cropped to the monitored zone  -> MJPEG      -> camera panel
      +-- state changes                                   -> WebSocket  -> map
      `-- occupancy level + transitions                   -> TimescaleDB -> analytics
```

### Occupancy is measured by overlap, not by a point

The obvious approach is to take the bottom centre of a detection box, roughly where the tyres
meet the ground, and ask which stall polygon contains it. That works when stalls sit square to
the camera. **It fails on angled stalls**, because the box around a diagonally parked car puts
its bottom centre outside the stall, usually in the driving aisle. Some stalls came out wrong in
thirty frames out of thirty.

Intersecting the actual stall polygon with the box instead was worth 23 points of accuracy. The
losing methods are still in `parktech/occupancy.py` behind `scripts/accuracy.py --method`, so the
comparison stays reproducible.

### The map is a schematic, and says so

What comes from the lot is its **structure**: which rows exist, how many stalls each holds, and
which stall sits where along each row. Everything else is regularised, so the map reads as a car
park rather than a perspective photograph traced by hand.

Stall sizes are uniform, every driving aisle is one fixed width and every planted median another,
and all rows share a left edge. Those last two were originally taken from the annotations and
both turned out to be carrying the camera's perspective rather than the lot's geometry. The row
offsets are the clearer case: fitting each row's left and right edge against its apparent stall
width puts both on the same vanishing point and recovers a row length of 22.00 stalls against an
actual 22, which only holds if the four long rows are physically identical and aligned.

Which gaps between rows are drivable is **configured per camera** in `config/rows.json`, not
inferred. Lane waypoints are only placed in those gaps, so a route can never cross a grass median
for a structural reason rather than a heuristic one: there is no edge in the graph to cross it.

An earlier version rectified the camera plane with a four-point homography. It was dropped: this
camera is already close to overhead, so correcting it distorted the layout more than it fixed.
`calibrate.py` and `parktech/homography.py` remain for a camera that needs it.

### Routes follow the lanes

The lanes are a graph: aisles across the lot, perpendicular lanes down both sides, a perimeter
road, and an aisle below the bottom row. Routing is a shortest path over it. Every segment
of every route is a real lane by construction, so a path can never cut diagonally across parked
cars.

A stall may only be entered from an aisle touching its own row, or a driver gets routed along the
bottom aisle and straight up through the row below it.

The map also routes from several **simulated starting positions**. These are not other drivers:
the system does not track other people and cannot. It is the same driver placed elsewhere, so the
routing can be seen adapting: same stall, different start, different way round.

### Nothing is reserved

An earlier version let a driver hold a stall for ninety seconds. Nothing physically stops another
car taking the space, so that was a promise the product could not keep. It shows the way there
instead. The server-side hold API still exists and still returns 409 on conflict; the driver view
does not use it.

## Accuracy

Measured against PKLot's own ground-truth labels, not asserted. Two cameras, and the numbers are
not interchangeable: **PUCPR is the one the demo runs on**, UFPR04 is where the occupancy method
was chosen and where the weather breakdown was measured.

### PUCPR, the demo camera

| Frames | Decisions | Accuracy | False positives |
|---|---|---|---|
| 150 | 14111 | 96.0% | 23 in 7628 free stalls |

150 frames strided across the whole dataset, scored with the shipping configuration:
`yolo11m` at 1920px, confidence 0.15, overlap 0.35. Reproduce it with:

```bash
python scripts/accuracy.py --camera PUCPR --model yolo11m.pt --imgsz 1920 --conf 0.15 --limit 150
```

### UFPR04, by weather

| Weather | Frames | Decisions | Accuracy | False positives |
|---|---|---|---|---|
| Sunny | 40 | 1117 | 97.7% | 0 |
| Cloudy | 33 | 921 | 98.7% | 2 |
| Rainy | 34 | 946 | 98.4% | 1 |

**Three false positives in 2984 decisions.** A false positive sends a driver to a stall that is
already taken, which is the failure that makes the product worse than not existing, so it is the
error worth counting separately.

Rain scores slightly better than sun, most likely because overcast light removes the hard shadows
that blur a car's boundary against the tarmac.

**Two numbers, and they differ.** The figures above are raw per-frame detection. The operator
view shows a running figure a few points lower, because the debouncer is always slightly behind
the truth it is being scored against. Both are honest; they measure different things.

**Not measured:** night. PKLot does not cover it, and it would need IR-capable hardware.

## The footage

The demo runs on **PKLot**, an academic benchmark: 4,473 annotated frames of a 100-stall lot at
five-minute intervals across 36 days, with per-stall ground truth.

**This is a lot in Brazil, not one on campus.** That is stated out loud in the demo. It was a
deliberate trade: PKLot ships per-stall polygons and occupied/vacant labels, which is what makes a
measured accuracy number possible instead of an asserted one.

Frames are replayed in real capture order. Stretches where nothing in the lot changes are thinned,
so a loop does not spend ninety seconds on an empty car park overnight. Every arrival and
departure is kept.

## Quickstart

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
docker compose up -d                     # TimescaleDB
python run.py --start 11:30
```

Frontend, in a second shell:

```bash
cd web && npm install && npm run dev
```

The frontend runs standalone against mock data with `VITE_USE_MOCK=1`, so it never needs the
Python pipeline running.

### Detections are precomputed

`yolo11m` at 1920px takes about 1.3 seconds a frame, which is fine for measuring accuracy and too
slow to drive a demo, and a laptop running a medium model flat out for an hour will thermal
throttle exactly when people are watching.

Detections for a fixed camera replaying fixed frames are deterministic, so they are computed once.
Replay goes from 0.8 fps to 11 fps, a 15x speedup, with no GPU work while the demo is running.

**This is an execution shortcut, not an accuracy shortcut.** The cached boxes are what the same
model produced with the same settings. The cache records the model, image size and confidence it
was built with and refuses to load against different ones, so a config change can never quietly
serve stale detections.

```bash
python scripts/precompute.py --start 11:30 --frames 400
```

## Scripts

| Script | What it answers |
|---|---|
| `scripts/gonogo.py` | Does pretrained YOLO see the cars at all? Reports median box size, which is the number that actually decides it |
| `scripts/accuracy.py` | Per-stall accuracy against ground truth, with a confusion matrix. `--method` compares occupancy strategies |
| `scripts/precompute.py` | Builds the detection cache |
| `scripts/validate_contracts.py` | Mocks still match the schemas, and spot ids line up across files |

## Repo layout

```
run.py           single entrypoint: replay + inference + API + WebSocket
calibrate.py     four-point camera calibration, for a camera that needs it
parktech/        vision pipeline, occupancy, layout, routing, db, api
config/          rows.json: row grouping and drivable gaps per camera
contracts/       the interface between the vision and web sides
scripts/         go/no-go, accuracy, precompute, contract validation
web/             Vite + React + TypeScript + Tailwind
data/PKLot/      dataset (gitignored)
data/cache/      precomputed detections (committed)
```

The Python package is still named `parktech/` from before the rename. It is internal, and nothing
user-facing refers to it.

## Team

[@lavneethora](https://github.com/lavneethora) and [@sharvapatill](https://github.com/sharvapatill)
