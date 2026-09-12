# ParkTech: PRD and 24-Hour Build Plan

## Context

HackWesTX VII runs Sept 12 to 13, 2026 at the TTU Innovation Hub. Theme: "Beyond the Feed."
Team is 2 people (Lavneet on vision, friend on frontend). Target is 1st Overall, with Best Use
of Tiger Data and Best UI/UX as secondary shots.

**The problem being solved:** parking lots already have capacity and already have cameras, but
nobody knows which specific stalls are free right now. Drivers circle, congest the lot, and
arrive late. ParkTech is an *infrastructure intelligence layer*: it ingests an existing fixed
camera feed and turns it into a live, clickable top-down map of stall availability.

**Why this shape:** the team cannot shoot original footage, so the demo runs on the PKLot
academic benchmark. That constraint is turned into an advantage, because PKLot ships per-space
polygon coordinates and occupied/vacant ground truth. This buys two things no YOLO parking
tutorial has: free annotations, and a **measured accuracy number** instead of an asserted one.

**Known weaknesses, stated up front so they get managed rather than discovered:**
- Parking occupancy via YOLO plus polygons is a heavily tutorialized problem. Innovation score
  depends entirely on the homography rectification and the measured accuracy, not the detection.
- The footage is from Brazil, not the Innovation Hub. The local-grounding advantage is gone.
  Compensate with rigor (accuracy numbers) and an explicit TTU deployment-target slide.
- Theme fit is a stretch. Bridge it once, cleanly, and move on.

---

## Product Definition

**One-liner:** ParkTech is a computer-vision layer for parking infrastructure that already
exists. It turns an ordinary fixed camera into a live map of which stalls are open, which one
you should take, and how the lot gets used over time.

**Two audiences, one product:**
- *Driver:* where is an open stall, which one is best, how do I get to it
- *Operator:* how is this lot actually utilized, when does it peak, how fast do stalls turn over

**Scope for the hackathon:** one camera, one zone, 20 to 40 stalls, replayed from a real
benchmark dataset. Multi-camera, multi-lot, and the "all parking under one umbrella" vision are
closing-slide material only. Do not build them.

### MVP acceptance criteria (stop adding core features once these pass)

1. Detect vehicles in PKLot footage and classify each annotated stall occupied or vacant
2. Report per-stall accuracy against PKLot ground truth across a full replayed day
3. Update state as occupancy changes, with debounce so nothing flickers
4. Render a rectified top-down twin that stays synchronized with the camera panel
5. Click a green stall, get a soft hold plus an animated in-lot route to it
6. Show a real occupancy-over-time chart built from stored time-series events

---

## Architecture

```
PKLot day sequence (fixed camera, 5-min intervals, ~288 frames/day)
            |
      replay loop  (time compression: a full day in ~90 seconds)
            |
      YOLO11n, COCO classes car/truck/bus
            |
   occupancy engine: bottom-center point-in-polygon against PKLot contours
      + N-frame debounce
      + live comparison against XML ground truth
            |
      +-----+--------------------+
      |                          |
  annotated frame          state change events
  (MJPEG /video)           (WebSocket /ws  +  TimescaleDB insert)
      |                          |
      +----------+---------------+
                 |
        React frontend (single page)
        |- Vision panel      (boxes, track IDs, stall outlines, live accuracy)
        |- Digital twin      (homography-rectified top-down, red/green/amber)
        |- Click to route    (soft hold + animated path)
        `- Analytics strip   (occupancy curve, turnover, peak)
```

**Single Python process.** One `python run.py` starts replay, inference, the API, the MJPEG
stream, and the WebSocket. No microservices, no separate worker, no curl-driven workflow.

**Why MJPEG for the video panel:** the browser consumes the annotated feed as
`<img src="http://localhost:8000/video">`. No WebRTC, no codec work, about 15 lines of server
code. Reliability over elegance at hour 3 of a hackathon.

---

## Repository Layout

```
parktech/
  run.py                  # single entrypoint: replay + inference + API + WS
  calibrate.py            # interactive: click 4 ground points -> homography.json
  parktech/
    pklot.py              # XML parser -> {spot_id: contour, ground_truth}
    detect.py             # YOLO11n wrapper, tracking, bottom-center points
    occupancy.py          # point-in-polygon, debounce, event emission
    homography.py         # 4-point warp, project contours + car points to top-down
    routing.py            # aisle graph, Dijkstra, entrance -> stall path
    db.py                 # Timescale writes, holds, continuous aggregate queries
    api.py                # FastAPI: /video, /ws, /api/state, /api/hold, /api/analytics
  config/
    homography.json       # from calibrate.py
    aisles.json           # hand-defined waypoint graph for routing
  web/                    # Vite + React + TS + Tailwind
  data/PKLot/             # gitignored
```

### The frozen contract (agree on this in the first 30 minutes, then never change it)

```json
{
  "camera_id": "UFPR04",
  "timestamp": "2013-01-15T10:32:17Z",
  "spots": {
    "A1": {"status": "occupied", "confidence": 0.94, "vehicle_id": 12},
    "A2": {"status": "available", "confidence": null, "vehicle_id": null},
    "A3": {"status": "held", "held_until": "2013-01-15T10:33:47Z"}
  },
  "cars": [{"id": 12, "x": 0.42, "y": 0.71}],
  "summary": {"total": 28, "occupied": 21, "available": 7, "accuracy": 0.942},
  "best_spot": "A7",
  "last_event": {"spot_id": "A7", "from": "occupied", "to": "available"}
}
```

Car `x`/`y` are normalized top-down coordinates, already warped server side. The frontend never
does geometry. Friend builds the entire UI against a mocked version of this file starting at
hour 1, so neither person is ever blocked on the other.

---

## Key Technical Decisions

**Detection:** COCO-pretrained `yolo11n.pt`, no training. Classes 2/5/7 (car, bus, truck).
Ultralytics is not currently installed on this machine, so budget setup time. Use
`model.track(persist=True, tracker="bytetrack.yaml")` for stable IDs, matching the
`from ultralytics import YOLO` idiom already used in `football-kick-analyzer/processKickVideo.py`.

**Occupancy test:** bottom-center of each box (`cx=(x1+x2)/2, cy=y2`, roughly where tires meet
ground) tested with `cv2.pointPolygonTest` against the PKLot contour. Simpler and more robust
than IoU for perspective views.

**Debounce:** occupied after 3 consecutive positive frames, available after 5 consecutive
negative. Prevents the red/green strobing that makes a demo look broken.

**The domain-gap risk:** PKLot cameras are distant, so cars may fall below roughly 30 pixels,
which is where COCO YOLO degrades sharply. This is the same class of problem that was the real
bottleneck on `football-kick-analyzer`. Mitigations in order: use `yolo11s` over `yolo11n`,
raise `imgsz` to 1280, lower `conf` to about 0.2, and crop to the annotated zone rather than
processing the full frame. **Do not fine-tune.** If detection still fails, switch cameras
(UFPR04 vs UFPR05 vs PUCPR have different distances) before changing anything else.

**Homography:** `calibrate.py` shows frame 1, you click 4 ground-plane points, it maps them to a
canvas rectangle and writes the 3x3 matrix. Every stall contour and every car bottom-center is
then warped through it. This is what makes cars visibly move across the top-down map, and it is
the main thing separating this from a tutorial. Rectify to a synthetic plane, not to satellite
imagery, so there is no need to locate the Brazilian lot on Google Maps.

**Tiger Data:** Tiger Cloud free tier as primary, local `timescale/timescaledb` Docker container
as the offline fallback, swapped by a single `DATABASE_URL`. Hackathon wifi fails; have the
fallback running before you need it.

```sql
-- hypertable, one row per state CHANGE only, never per frame
parking_events (time TIMESTAMPTZ, camera_id TEXT, spot_id TEXT,
                status TEXT, confidence REAL, vehicle_id INT)
spot_holds     (spot_id TEXT, session_id TEXT, held_until TIMESTAMPTZ)
```
Add a **continuous aggregate** over `parking_events` bucketed by 5 minutes. Tiger Data's
challenge text calls out continuous aggregates by name, so using one is a direct hit rather
than a generic "we used their database" claim.

**Soft hold (this is the Q&A insurance):** clicking a stall inserts a 90-second hold. Held
stalls render amber, are excluded from `best_spot`, and are not offered to any other session.
The hold releases on expiry or when the camera sees a car arrive. Roughly 30 lines of code, and
it pre-answers the single most likely judge question: "what if two people click the same spot?"

**Routing:** hand-define about 10 aisle waypoints in `aisles.json`, run Dijkstra from the
entrance node to the stall, animate the SVG path with `stroke-dashoffset`. In-lot routing only.
Do not wire this to Google Maps; consumer GPS is accurate to 3 to 5 meters, which is wider than
a stall, and overselling it invites a question you cannot win.

**Frontend:** Vite + React + TypeScript + Tailwind (faster to stand up than Next.js for a
single-page dashboard). Visual language follows
`design-system/output/poke.com/DESIGN.md` per standing preference.

---

## Build Timeline (2 people, ~15 usable build hours each)

Wall clock is 24 hours. Subtract opening ceremony, food, sleep, and about 2 hours for Devpost
and the demo video that everyone underestimates.

| Hours | Lavneet (vision) | Friend (frontend) |
|---|---|---|
| 0-1 | Repo, venv, `pip install ultralytics`, start PKLot download in background, Timescale up | Vite + React + Tailwind scaffold, read DESIGN.md, **write `mock_state.json` from the contract** |
| 1-2 | **GO/NO-GO: YOLO on one PKLot frame.** Do cars come back boxed? | Two-panel layout shell, wired to mock JSON on a timer |
| 2-5 | `pklot.py` XML parser, `occupancy.py`, print `A1 OCCUPIED / A2 AVAILABLE` to console, compute accuracy vs ground truth | Vision panel, top-down stall rendering, red/green states, counts |
| 5-7 | FastAPI: `/video` MJPEG, `/ws`, Timescale writes on state change | Swap mock for live WebSocket. **First end-to-end sync.** |
| 7-9 | **Homography, 90-min hard timebox.** `calibrate.py` + warp contours and car points | Consume warped coords, render cars moving on the twin, transition animations |
| 9-12 | Staggered sleep, 3 to 4 hours each, never both awake-zombie at judging | Staggered sleep |
| 12-14 | Soft hold, best-spot selection, continuous aggregate query | Click-to-route animation, amber held state, activity feed |
| 14-17 | Accuracy panel, camera-health badge, edge-privacy badge | Analytics strip: occupancy curve, peak, turnover. Full design polish |
| 17-19 | Pitch script, judge Q&A prep | Devpost writeup, record demo video |
| 19-22 | Rehearse the 90-second run twice. **Submit early.** | Rehearse, submit |
| 22-24 | Buffer. Fix only what is broken. Add nothing. | Buffer |

### Hard kill switches (write these down now, while calm)

- **Hour 2:** if YOLO cannot see cars in PKLot frames after trying `yolo11s`, `imgsz=1280`,
  lower `conf`, and a different camera, the project pivots. Do not debug past this.
- **Hour 4:** if `A1 OCCUPIED / A2 AVAILABLE` does not print from real frames, pivot.
- **Hour 9:** if homography is not warping cleanly, ship the flat schematic and never revisit.
- **Hour 17:** feature freeze. Anything unfinished becomes a "what's next" bullet.

### Explicitly out of scope

Vultr, Auth0, Gemini, ElevenLabs, Solana, custom training, multi-camera fusion, camera-placement
optimization, license plates, multi-lot selector, mobile app, turn-by-turn navigation, predictive
ML. Every one of these is a closing slide, not a commit.

---

## Presentation

**Theme bridge, said once:** "Beyond the Feed made us think about technology beyond a screen.
Algorithms decide what we see online. We wanted computer vision to improve something physical
happening around us."

**The 90-second run:**
1. "Every lot already has cameras. None of them know which stalls are free."
2. Point left: boxes, track IDs, stall outlines live on the footage
3. Point right: "every stall has a digital counterpart"
4. Stay quiet while a car leaves. Left shows exiting, right flips red to green, count ticks up
5. Click the green stall: hold goes amber, route animates
6. "94% per-stall accuracy, measured against ground truth across a full day including rain"
7. Analytics: "and the lot now has a utilization history it never had"

**Honesty slide, non-negotiable:** state plainly that the footage is the PKLot benchmark, not
the Innovation Hub, and that this was a time constraint. Then show the Innovation Hub lot on
Google Maps satellite as the deployment target. Being caught overstating this costs more than
admitting it.

**Pre-built Q&A:**
- *Two people click the same spot?* Soft holds, with the amber state on screen
- *Why not per-stall sensors?* Hardware at every stall versus one camera covering many
- *Night, rain, snow?* PKLot includes rainy and cloudy days and the accuracy number covers them.
  Night is unvalidated and would need IR hardware. Say so.
- *Occlusion?* Overlapping camera zones in production. Show the architecture graphic
- *Privacy?* Only occupancy state leaves the device. No faces, no plates, no video retained
- *How is this different from SpotHero or ParkMobile?* They handle reservations and payment.
  None of them know whether a physical stall is empty right now. That gap is the claim
- *Did you hand-annotate the stalls?* No. Four clicks calibrate a camera, and the rectification
  handles arbitrary mounting angles. That is the honest answer to the scaling question

---

## Verification

**Vision layer (standalone, before any UI exists):**
- `python run.py --headless --camera UFPR04 --date 2013-01-15` prints per-stall status per frame
- Accuracy harness compares every frame against the XML `occupied` attribute and prints overall
  per-stall accuracy plus a confusion matrix. Target is 90%+; below 85% means change camera or
  detector size before proceeding
- Confirm debounce works: no stall changes state more than once per 3 frames on a static stretch

**Homography:**
- `python calibrate.py` then visually confirm warped stall polygons form a regular grid.
  If the rectified stalls look like a fan rather than a grid, the 4 clicked points were not
  coplanar on the ground. Reclick

**End to end:**
- Start `run.py`, open the web app, confirm the camera panel and twin agree on every stall
- Scrub to a frame where a known stall changes and confirm both panels flip within one frame
  of each other, and the count updates
- Click a green stall: verify amber render, verify a second browser session no longer sees it
  offered, verify it releases after 90 seconds
- `SELECT * FROM parking_events ORDER BY time DESC LIMIT 20` returns state changes only, not
  one row per frame
- Analytics chart renders from the continuous aggregate, not from client-side computation

**Demo readiness:**
- Full run with wifi disabled, using the local Docker Timescale fallback
- Two clean rehearsals of the 90-second script against the running system
