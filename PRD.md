# ParkTech: PRD and 24-Hour Build Plan

## Context

HackWesTX VII runs Sept 12 to 13, 2026 at the TTU Innovation Hub. Theme: "Beyond the Feed."
Team is 2 people: Lavneet on vision, Sharva on frontend. Target is 1st Overall, with Best Use
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
does geometry. Sharva builds the entire UI against a mocked version of this file starting at
hour 1, so neither person is ever blocked on the other.

---

## Key Technical Decisions

**Detection:** COCO-pretrained `yolo11n.pt`, no training. Classes 2/5/7 (car, bus, truck).
Ultralytics is not currently installed on this machine, so budget setup time. Use
`model.track(persist=True, tracker="bytetrack.yaml")` for stable IDs, matching the
`from ultralytics import YOLO` idiom already used in `football-kick-analyzer/processKickVideo.py`.

**Occupancy test:** polygon overlap. For each stall, intersect its contour with every detection
box and call it taken when a box covers at least 35% of the stall
(`occupancy.assign_overlap`).

This replaces the bottom-centre point test originally specified here, which was wrong and
measured at 23 points worse. The reasoning behind it, that a point test beats IoU for
perspective views, holds only when stalls sit square to the camera. PKLot's stalls are
**angled**, and YOLO returns axis-aligned boxes, so the bottom centre of a diagonally parked
car lands outside its own stall, usually in the driving aisle. Certain stalls were therefore
wrong in 30 frames out of 30: not occlusion, not a missed detection, just a point falling a few
pixels outside a rotated quad every time.

Measured on 55 frames of UFPR04 strided across days, weather and times (1537 decisions,
714 occupied / 823 free):

| Method | Accuracy | False positives | False negatives |
|---|---|---|---|
| `point` (bottom centre in polygon) | 74.9% | - | - |
| `centroid` (stall centre inside a box) | 98.0% | 1 | 29 |
| **`overlap` (polygon intersection, default)** | **97.9%** | **0** | 32 |

`overlap` ships despite being 0.1 point behind, which is one decision in 1537 and inside the
noise. It produced **zero false positives across 823 free stalls**. A false positive sends a
driver to a stall that is already taken, which is the failure that makes the product worse than
not existing, so it is worth trading a rounding error for. All three methods stay in
`parktech/occupancy.py` behind `scripts/accuracy.py --method`, so the claim stays reproducible.

**Debounce:** occupied after 3 consecutive positive frames, available after 5 consecutive
negative. Prevents the red/green strobing that makes a demo look broken.

**The domain-gap risk: resolved, and it was half the story.** PKLot frames are 1280x720 and the
cameras are distant, so at the default 640px input cars fall near the 30px floor where COCO YOLO
degrades. The validated configuration is **`yolo11s.pt`, `imgsz=1280`, `conf=0.2`**, which took
the point-test baseline from 50.7% to 74.9%.

Worth recording that the detector was only half the problem. Settings alone never got close to
shippable; fixing the occupancy geometry did the rest. Measure the geometry before blaming the
model.

Cost: roughly 1 to 2 seconds per frame on MPS. Irrelevant here because we replay stills under
time compression, but it rules out real-time 30fps video on this hardware, so do not promise
"live" on stage.

**No fine-tuning was needed and none should be attempted.**

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

| Hours | Lavneet (vision) | Sharva (frontend) |
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

## Work Split Across Two Claude Sessions

Two agents in parallel fail for one reason: they edit the same files. The fix is not a clever
branch model, it is **strict directory ownership plus a contract that lands before anyone
branches.** Git is just the transport.

### Step 0: repo setup (Lavneet, alone, before either session starts building)

Nobody branches until `main` has the interface on it.

The repo is `lavneethora/TechPark` (private). Sharva (`sharvapatill`) is already a collaborator.
Everything below lands as PRs, same as all other work.

1. This PR: replace the old PRDs with this one, write the README
2. Commit the skeleton: every directory from the layout above with `.gitkeep`
3. Commit `.gitignore`: `data/`, `venv/`, `node_modules/`, `*.pt`, `.env`
4. Commit `contracts/state.schema.json` and `contracts/mock_state.json` (the frozen contract)
5. Commit the root `CLAUDE.md` (below). This is what keeps each session in its lane
6. Commit `.github/CODEOWNERS` so reviews auto-request the right person:
   ```
   /parktech/   @lavneethora
   /run.py      @lavneethora
   /web/        @sharvapatill
   /contracts/  @lavneethora @sharvapatill
   ```
7. Commit `.github/workflows/ci.yml` (Python import plus ruff, and `npm run build` in `web/`)
8. **Enable branch protection on `main`**: require a PR, require one approving review, require
   the CI check to pass
9. Copy the design reference to `web/docs/DESIGN.md` so Sharva's machine can read it
10. Both teammates run `gh auth login` on their own machine before starting

This scaffolding is 25 minutes and it is the highest-leverage 25 minutes of the event.

### Ownership table (goes in CLAUDE.md, enforced by both sessions)

| Path | Owner | Other session may |
|---|---|---|
| `run.py`, `calibrate.py`, `parktech/**` | **A (vision)** | read only |
| `config/*.json` | **A** | read only |
| `web/**` | **B (frontend)** | read only |
| `contracts/**` | **shared** | change only at a sync point, by agreement |
| `README.md` | A until hour 17, then B | |

Overlap is exactly one directory, and that one is frozen. This is what makes parallel agents
safe, far more than any PR process.

### Root `CLAUDE.md` (both sessions read this automatically)

```markdown
# ParkTech

HackWesTX VII. Two-person team, two parallel Claude sessions.

## Your lane
Session A owns Python: run.py, calibrate.py, parktech/, config/
Session B owns the web app: web/
NEVER edit files outside your lane. If you believe a file in the other lane needs
to change, STOP and tell the user. Do not fix it yourself.

## contracts/
contracts/state.schema.json is the interface between the two lanes.
After hour 1 it is ADDITIVE ONLY: you may add fields, never rename or remove one.
Any change here requires the user to sync with the other session first.

## Conventions
- One file per commit. Commit each file the moment you finish editing it.
- Space commit timestamps apart. Do not let a batch land on the same second.
- NEVER add "Co-Authored-By: Claude", "Generated with Claude Code", or any other AI
  attribution to a commit message or a PR description. This is a hard rule.
- No em dashes anywhere: code, comments, docs, commit messages.
- Never push to main. Every change is a PR reviewed by the other teammate.
- Prefer a single `python run.py` entrypoint over server-plus-curl workflows.
- UI follows design-system/output/poke.com/DESIGN.md.
```

### Branch model, tuned for 24 hours

Long-lived `vision` and `web` branches are wrong here; they diverge and you pay for it at 3am.
Use short task branches off `main`, merged at the sync points already in the timeline.

```
main ────●────●──────────●──────────●──────────● (always demo-able)
          \    \        /          /          /
 A:        ●────●──────/──────────/──────────/    vision/occupancy, vision/homography, ...
            \          \        /          /
 B:          ●──────────●──────/──────────/       web/shell, web/twin, web/routing
```

Branch naming: `vision/<thing>`, `web/<thing>`. Small and short-lived, hours not half-days.

**Every change goes through a PR, reviewed by the other teammate. Nothing is pushed directly to
`main`, ever.** Enforce it rather than relying on discipline: after the Step 0 push, turn on
branch protection on `main` requiring one approving review.

The obvious risk is a PR blocking on a sleeping teammate. Three things remove it:

**1. Stacked branches.** Never branch off an unmerged PR's target, branch off the PR itself.
If Lavneet finishes `vision/occupancy` while Sharva is asleep, he opens the PR and then starts
`vision/homography` **off `vision/occupancy`**, not off `main`. Work continues at full speed and
the stack merges in order when Sharva wakes up. This is the single technique that makes
always-PR compatible with staggered sleep.

```bash
git checkout -b vision/homography vision/occupancy   # stack, do not wait
gh pr create --base vision/occupancy --fill          # retarget to main after the parent lands
```

**2. CI so review is a skim, not an audit.** A small GitHub Action (about 20 minutes to set up,
worth it) that on every PR runs `python -c "import parktech"` plus `ruff check`, and
`npm ci && npm run build` in `web/`. Once green means "it at least runs," an approval is a
30-second read of the diff instead of a careful review, which is the only kind of review that
actually happens at hour 14.

**3. Auto-merge plus a review SLA.** Open every PR with `gh pr merge --auto --squash` so it
lands the instant CI is green and approval arrives. Target 15 minutes to review while both are
awake. Reviews are a skim for two things only: did this touch the other lane, and did it change
`contracts/`. Style nits go in the Devpost, not in a PR comment.

**Emergency path, agreed in advance so nobody improvises at 3am:** if `main` is broken during
the hour 17 freeze and the other person is unreachable, the fix still goes up as a PR, and it is
self-merged with the reason in the PR body. Document it, do not silently bypass it.

Keep PRs small and single-purpose, roughly one per row of the timeline table. A 40-file PR at
hour 12 will not get reviewed, it will get rubber-stamped, which is worse than no process.

### Sync points (map onto the build timeline)

| Hour | Sync | Both sides do |
|---|---|---|
| 0.5 | **Contract live** | Branch from `main`. B starts against the mock immediately |
| 5 | **First integration** | A merges occupancy plus API, B merges UI shell. Run end to end together |
| 9 | **Twin live** | A merges homography and warped coords, B merges rectified rendering |
| 14 | **Interaction live** | A merges holds and routing backend, B merges click-to-route |
| 17 | **Freeze** | `main` is the demo. Bugfix commits only, no new branches |

Protocol at every sync, in this order: both open their PRs, **review and approve each other's**,
let auto-merge land them, both `git pull origin main`, then run the system end to end
**together**. Only then keep building. A sync that does not include an actual end-to-end run is
not a sync, it is just a merge.

Reviews at a sync point are mutual and blocking, which is the one moment in the day where the
PR requirement is genuinely earning its keep rather than costing you time. Between syncs, use
stacked branches so neither person idles waiting on the other.

### B must never be blocked on A

This is what makes the parallelism real. The frontend ships a mock mode from hour 1:

- `VITE_USE_MOCK=1` makes the app generate its own state stream in-process, replaying a scripted
  sequence including a stall flipping occupied to available
- No second process, no waiting on Python, no waiting on the PKLot download
- B builds the entire transition animation, the routing UI, and the full design polish before
  A's pipeline exists

Flip the flag at hour 5 and it should just work, because both sides coded to the same schema.

### Handling contract changes without breaking the other session

The number one killer of parallel work. Two rules:

1. **Additive only after hour 1.** Add fields freely. Never rename, never remove
2. **Frontend ignores unknown fields, backend keeps emitting old ones** for one sync cycle

That way neither side can break the other by shipping first.

### Machine setup

Two laptops, two clones, GitHub as the hub. Lavneet's Mac runs Session A, Sharva's machine runs
Session B. Nothing is shared between them except the remote, which is exactly why the lane split
matters: neither agent can see or accidentally edit the other's working tree.

Per-machine prerequisites before the clock starts:
- **Lavneet:** Python 3.12 (present), `pip install ultralytics` (**not currently installed**),
  Docker (present) for the Timescale fallback, `gh auth login`
- **Sharva:** Node 24+, `gh auth login`
- Both: clone only after Step 0 has pushed `main` and branch protection is on

### Kickoff prompt for each session

Paste these as the first message so each agent knows its boundary before it writes anything.

**Session A (Lavneet's machine, vision):**
> You are Session A on ParkTech. You own Python only: `run.py`, `calibrate.py`, `parktech/`,
> `config/`. Never edit `web/`. Read `CLAUDE.md` and `contracts/state.schema.json` first.
> Workflow: branch off main, one file per commit, then `gh pr create`. Never push to main.
> Never put AI attribution in a commit message or PR body.
> Task 1 is the go/no-go: get YOLO11n detecting cars in a single PKLot frame and report back
> before building anything else. If detection fails, try yolo11s, imgsz 1280, lower conf, and a
> different camera, in that order. Do not fine-tune.

**Session B (Sharva's machine, frontend):**
> You are Session B on ParkTech. You own `web/` only. Never edit Python files. Read `CLAUDE.md`,
> `contracts/state.schema.json`, `contracts/mock_state.json`, and `web/docs/DESIGN.md` first.
> Workflow: branch off main, one file per commit, then `gh pr create`. Never push to main.
> Never put AI attribution in a commit message or PR body.
> Build the entire UI against mock data behind `VITE_USE_MOCK=1`. You must not need the Python
> backend running at any point today.

**Gotcha worth catching now:** `design-system/output/poke.com/DESIGN.md` lives on Lavneet's Mac,
not in this repo, so Sharva's session cannot read it. Copy it to `web/docs/DESIGN.md` during
Step 0. Do not leave Session B pointed at a path that does not exist on its machine.

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
