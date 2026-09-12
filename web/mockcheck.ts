import { MockPipeline } from "./src/lib/mock";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

const p = new MockPipeline() as unknown as {
  compose(ms: number): any;
  getLayout(): Promise<any>;
  hold(id: string): Promise<any>;
};

const layout = await p.getLayout();
check("layout has 28 stalls", Object.keys(layout.spots).length === 28);

// Walk the ten frames in order, one compose per frame boundary.
const events: any[] = [];
const states: any[] = [];
for (let i = 0; i < 10; i += 1) {
  const s = p.compose(i * 2000);
  states.push(s);
  if (s.last_event) events.push({ frame: i, ...s.last_event });
}

check("first emission reports no transition", states[0].last_event === null, JSON.stringify(states[0].last_event));
check("exactly one transition across the ten frames", events.length === 1, JSON.stringify(events));
check(
  "frame 4 is A7 occupied to available",
  events[0]?.frame === 4 && events[0]?.spot_id === "A7" && events[0]?.from === "occupied" && events[0]?.to === "available",
  JSON.stringify(events[0]),
);
check("available goes 6 then 7 across frame 4", states[3].summary.available === 6 && states[4].summary.available === 7,
  `${states[3].summary.available} -> ${states[4].summary.available}`);

for (const s of states) {
  const held = Object.values(s.spots).filter((x: any) => x.status === "held").length;
  if (s.summary.occupied + s.summary.available + held !== s.summary.total) {
    check("summary always adds up", false, JSON.stringify(s.summary));
    break;
  }
}
check("summary always adds up", true);

// last_event must fire once per frame, not on every tick inside it.
const p2 = new MockPipeline() as any;
p2.compose(0);
const mid = [p2.compose(2000), p2.compose(2125), p2.compose(2250)];
check("transition does not repeat within a frame", mid.slice(1).every((s: any) => s.last_event === null));

// Car interpolation. Frame 5 has car 12 at x 0.46, frame 6 at 0.48.
const p3 = new MockPipeline() as any;
p3.compose(0);
const atFrame5 = p3.compose(10000).cars.find((c: any) => c.id === 12);
const halfway = p3.compose(11000).cars.find((c: any) => c.id === 12);
check("car sits on the fixture value at a frame boundary", Math.abs(atFrame5.x - 0.46) < 1e-9, String(atFrame5.x));
check("car interpolates between frames", Math.abs(halfway.x - 0.47) < 1e-9, String(halfway.x));

// best_spot must be the nearest available stall, and must move when that stall is held.
const p4 = new MockPipeline() as any;
const s0 = p4.compose(0);
const nearestAvailable = Object.entries(s0.spots)
  .filter(([, v]: any) => v.status === "available")
  .sort((a: any, b: any) => layout.spots[a[0]].distance_to_entrance_m - layout.spots[b[0]].distance_to_entrance_m)[0][0];
check("best_spot is the nearest available stall", s0.best_spot === nearestAvailable, `${s0.best_spot} vs ${nearestAvailable}`);

const held = await p4.hold(s0.best_spot);
check("hold returns a route with at least three waypoints", held.route.length >= 3, JSON.stringify(held.route));
check("hold expiry is about 90 seconds out", Math.abs(new Date(held.held_until).getTime() - Date.now() - 90000) < 2000);

const s1 = p4.compose(125);
check("held stall renders as held", s1.spots[held.spot_id].status === "held", s1.spots[held.spot_id].status);
check("held stall carries held_until", typeof s1.spots[held.spot_id].held_until === "string");
check("available count drops by one when a stall is held", s1.summary.available === s0.summary.available - 1,
  `${s0.summary.available} -> ${s1.summary.available}`);
check("best_spot moves off the held stall", s1.best_spot !== held.spot_id, String(s1.best_spot));
check("hold did not disturb frame tracking", s1.last_event === null, JSON.stringify(s1.last_event));

let rejected = false;
const occupiedId = Object.entries(s1.spots).find(([, v]: any) => v.status === "occupied")?.[0] as string;
try {
  await p4.hold(occupiedId);
} catch {
  rejected = true;
}
check("holding an occupied stall is rejected", rejected);

// A hold must die the moment the camera sees a car arrive, not only on expiry.
const p5 = new MockPipeline() as any;
p5.compose(8000); // frame 4, A7 just became available
await p5.hold("A7");
check("A7 is held after frame 4", p5.compose(8125).spots.A7.status === "held");
const wrapped = p5.compose(0); // loop back to frame 0, where A7 is occupied again
check("hold releases when a car arrives", wrapped.spots.A7.status === "occupied", wrapped.spots.A7.status);

// The wrap from the last frame to the first is a real transition and must be reported.
const p6 = new MockPipeline() as any;
for (let i = 0; i < 10; i += 1) p6.compose(i * 2000);
const wrapState = p6.compose(20000);
check("wrap back to frame 0 reports A7 filling", wrapState.last_event?.spot_id === "A7" && wrapState.last_event?.to === "occupied",
  JSON.stringify(wrapState.last_event));

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
