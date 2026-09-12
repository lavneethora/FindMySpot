/**
 * Regression check for the mock pipeline.
 *
 * Everything here is derived from whatever is in contracts/, never written against a
 * particular stall id, frame number or count. The fixtures are going to be regenerated from
 * the live pipeline, and a suite that has to be hand edited every time the data changes is a
 * suite that gets deleted at 3am.
 */

import rawLayout from "@contracts/mock_layout.json";
import rawSequence from "@contracts/mock_sequence.json";
import { FRAME_MS, HOLD_MS, MockPipeline, TICK_MS } from "./src/lib/mock";
import type { Layout, ParkState, SpotStatus } from "./src/lib/contract";

const layout = rawLayout as unknown as Layout;
const frames = rawSequence as unknown as ParkState[];

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

type Pipe = {
  compose(ms: number): ParkState;
  getLayout(): Promise<Layout>;
  hold(id: string): Promise<{ spot_id: string; held_until: string; route: number[][] }>;
};
const open = () => new MockPipeline() as unknown as Pipe;

const ids = Object.keys(layout.spots);
const n = frames.length;
const statusIn = (frame: ParkState, id: string): SpotStatus | undefined => frame.spots[id]?.status;

/** Every status change between two frames. */
function changesBetween(a: ParkState, b: ParkState) {
  return ids
    .map((id) => ({ id, from: statusIn(a, id), to: statusIn(b, id) }))
    .filter((c) => c.from !== undefined && c.to !== undefined && c.from !== c.to);
}

check("the fixture has a layout and a sequence", ids.length > 0 && n > 1, `${ids.length} stalls, ${n} frames`);

// ---- structure -----------------------------------------------------------------------
const p0 = open();
const walk: ParkState[] = [];
for (let i = 0; i < n; i += 1) walk.push(p0.compose(i * FRAME_MS));

check("every frame reports every stall in the layout", walk.every((s) => ids.every((id) => s.spots[id] !== undefined)));
check(
  "the summary always adds up",
  walk.every((s) => {
    const held = Object.values(s.spots).filter((x) => x.status === "held").length;
    return s.summary.occupied + s.summary.available + held === s.summary.total;
  }),
);
check("the total matches the layout", walk.every((s) => s.summary.total === ids.length));

// ---- transitions ---------------------------------------------------------------------
check("the first emission reports no transition", walk[0].last_event == null, JSON.stringify(walk[0].last_event));

const reported = walk.map((s, i) => ({ i, event: s.last_event })).filter((r) => r.event);
const changedFrames = walk.slice(1).filter((_, i) => changesBetween(frames[i], frames[i + 1]).length > 0);

check(
  "a transition is reported on exactly the frames where something changed",
  reported.length === changedFrames.length,
  `${reported.length} reported, ${changedFrames.length} frames changed`,
);
check(
  "every reported transition is a change that really happened",
  reported.every(({ i, event }) => {
    const previous = frames[(i - 1 + n) % n];
    return (
      event != null &&
      statusIn(previous, event.spot_id) === event.from &&
      statusIn(frames[i], event.spot_id) === event.to
    );
  }),
  JSON.stringify(reported.map((r) => r.event)),
);

const firstChange = walk.findIndex((s, i) => i > 0 && s.last_event);
if (firstChange > 0) {
  const p1 = open();
  for (let i = 0; i < firstChange; i += 1) p1.compose(i * FRAME_MS);
  const boundary = p1.compose(firstChange * FRAME_MS);
  const inside = [
    p1.compose(firstChange * FRAME_MS + TICK_MS),
    p1.compose(firstChange * FRAME_MS + TICK_MS * 2),
  ];
  check("the transition fires on the frame boundary", boundary.last_event != null);
  check("it does not repeat on later ticks inside the same frame", inside.every((s) => s.last_event == null));
} else {
  check("the fixture contains at least one transition", false, "nothing changes status, so the demo moment is missing");
}

const wrapChanges = changesBetween(frames[n - 1], frames[0]);
if (wrapChanges.length > 0) {
  const p2 = open();
  for (let i = 0; i < n; i += 1) p2.compose(i * FRAME_MS);
  const wrapped = p2.compose(n * FRAME_MS);
  check(
    "the loop back to the first frame is reported as a change",
    wrapped.last_event != null && wrapChanges.some((c) => c.id === wrapped.last_event?.spot_id),
    JSON.stringify(wrapped.last_event),
  );
}

// ---- car interpolation ---------------------------------------------------------------
let moving: { frame: number; id: number; from: number; to: number } | null = null;
for (let i = 0; i < n && !moving; i += 1) {
  const next = frames[(i + 1) % n];
  for (const car of frames[i].cars) {
    const after = next.cars.find((c) => c.id === car.id);
    if (after && after.x !== car.x) {
      moving = { frame: i, id: car.id, from: car.x, to: after.x };
      break;
    }
  }
}

if (moving) {
  const found = moving;
  const p3 = open();
  p3.compose(0);
  const at = p3.compose(found.frame * FRAME_MS).cars.find((c) => c.id === found.id);
  const half = p3.compose(found.frame * FRAME_MS + FRAME_MS / 2).cars.find((c) => c.id === found.id);
  check("a car sits on the fixture value at a frame boundary", at != null && Math.abs(at.x - found.from) < 1e-9);
  check(
    "a car interpolates halfway between frames",
    half != null && Math.abs(half.x - (found.from + found.to) / 2) < 1e-9,
    `${half?.x} should sit between ${found.from} and ${found.to}`,
  );
} else {
  check(
    "some car moves between frames, so there is motion to interpolate",
    false,
    "every car is stationary in every frame",
  );
}

check(
  "every car stays inside the lot",
  walk.every((s) => s.cars.every((c) => c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1)),
);

// ---- best spot -----------------------------------------------------------------------
function nearestAvailable(state: ParkState): string | null {
  let best: string | null = null;
  let far = Infinity;
  for (const id of ids) {
    if (state.spots[id]?.status !== "available") continue;
    const d = layout.spots[id]?.distance_to_entrance_m ?? Infinity;
    if (d < far) {
      far = d;
      best = id;
    }
  }
  return best;
}
check(
  "best_spot is always the nearest available stall",
  walk.every((s) => s.best_spot === nearestAvailable(s)),
  JSON.stringify(walk.map((s) => s.best_spot)),
);

// ---- holds ---------------------------------------------------------------------------
const p4 = open();
const before = p4.compose(0);
const free = ids.find((id) => before.spots[id]?.status === "available");
const taken = ids.find((id) => before.spots[id]?.status === "occupied");

if (free) {
  const held = await p4.hold(free);
  check(
    "a hold expires about ninety seconds out",
    Math.abs(new Date(held.held_until).getTime() - Date.now() - HOLD_MS) < 2000,
  );
  check("a hold comes with a route of at least three waypoints", held.route.length >= 3, JSON.stringify(held.route));
  check(
    "the route starts at the entrance",
    Math.hypot(held.route[0][0] - layout.entrance.x, held.route[0][1] - layout.entrance.y) < 1e-9,
  );
  const end = held.route[held.route.length - 1];
  const target = layout.spots[held.spot_id].centroid;
  check("the route ends at the held stall", Math.hypot(end[0] - target[0], end[1] - target[1]) < 1e-9);
  check("every waypoint is inside the lot", held.route.every((q) => q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1));
  check(
    "no two waypoints sit on top of each other",
    held.route.every((q, i) => i === 0 || Math.hypot(q[0] - held.route[i - 1][0], q[1] - held.route[i - 1][1]) > 1e-4),
  );

  const after = p4.compose(TICK_MS);
  check("the held stall renders as held", after.spots[free].status === "held");
  check("the held stall carries an expiry", typeof after.spots[free].held_until === "string");
  check("the available count drops by one", after.summary.available === before.summary.available - 1);
  check("best_spot moves off the held stall", after.best_spot !== free, String(after.best_spot));
  check("placing a hold does not disturb frame tracking", after.last_event == null);
} else {
  check("the fixture has at least one free stall to hold", false, "every stall is occupied in the first frame");
}

if (taken) {
  let rejected = false;
  try {
    await p4.hold(taken);
  } catch {
    rejected = true;
  }
  check("holding an occupied stall is rejected", rejected);
}

let arrival: { frame: number; id: string } | null = null;
for (let i = 0; i < n && !arrival; i += 1) {
  for (const c of changesBetween(frames[i], frames[(i + 1) % n])) {
    if (c.from === "available" && c.to === "occupied") {
      arrival = { frame: i, id: c.id };
      break;
    }
  }
}

if (arrival) {
  const seen = arrival;
  const p5 = open();
  p5.compose(seen.frame * FRAME_MS);
  await p5.hold(seen.id);
  check(
    "the stall is held before the car arrives",
    p5.compose(seen.frame * FRAME_MS + TICK_MS).spots[seen.id].status === "held",
  );
  const next = p5.compose(((seen.frame + 1) % n) * FRAME_MS);
  check("the hold releases when a car arrives", next.spots[seen.id].status === "occupied", next.spots[seen.id].status);
} else {
  console.log("  skip no stall fills during the sequence, so arrival release is untested");
}

const served = await open().getLayout();
check("the pipeline serves the layout it was built from", Object.keys(served.spots).length === ids.length);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
