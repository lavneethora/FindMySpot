# ParkTech

A computer-vision layer for parking infrastructure that already exists. It turns an ordinary
fixed camera into a live map of which stalls are open, which one you should take, and how the
lot gets used over time.

Built for HackWesTX VII, Texas Tech University

## The problem

Parking lots already have capacity and already have cameras. Nobody knows which specific stalls
are free right now, so drivers circle, congest the lot, and arrive late. ParkTech does not add
parking. It makes the parking that exists observable.

## What it does

**For the driver:** a live top-down map of the lot. Green is open, red is taken, amber is held.
Click a green stall and you get a short hold on it plus a route through the lot to that spot.

**For the operator:** a real utilization history the lot never had before. Occupancy over time,
peak periods, stall turnover rate.

## How it works

```
fixed camera feed
      |
YOLO11n vehicle detection + ByteTrack IDs
      |
occupancy engine: bottom-center point-in-polygon against stall contours, debounced
      |
      +-- annotated video (MJPEG)      -> vision panel
      +-- state changes (WebSocket)    -> digital twin
      `-- time-series events (Timescale) -> analytics
```

The top-down view is not a drawing. A 4-point homography rectifies the camera plane, so stall
polygons and live vehicle positions are projected into a true overhead view. Calibrating a new
camera is four clicks, not hand-annotating every stall.

Video never leaves the machine that processes it. Only occupancy state is persisted: no faces,
no plates, no stored footage.

## Demo data

The demo runs on the **PKLot** benchmark (fixed cameras, 5-minute intervals, with per-space
polygon coordinates and occupied/vacant ground truth). That choice is deliberate: it means the
accuracy number reported in the UI is measured against ground truth rather than asserted.

PKLot is a Brazilian parking lot, not the Innovation Hub. The demo says so out loud.

## Repo layout

```
run.py           single entrypoint: replay + inference + API + WebSocket
calibrate.py     interactive: click 4 ground points -> homography.json
parktech/        vision pipeline, occupancy engine, db, api
config/          homography.json, aisles.json
contracts/       state.schema.json, the interface between the two lanes
web/             Vite + React + TypeScript + Tailwind frontend
data/PKLot/      dataset (gitignored)
```

## Quickstart

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python run.py
```

Frontend, in a second shell:

```bash
cd web && npm install && npm run dev
```

The frontend runs standalone against mock data with `VITE_USE_MOCK=1`, so it never needs the
Python pipeline running.

## Team

[@lavneethora](https://github.com/lavneethora) and [@sharvapatill](https://github.com/sharvapatill)
