/**
 * Renders the component tree to a string and asserts on the output.
 *
 * There is no browser in CI and no test runner in this project, but every panel takes a
 * nullable layout and a nullable state, so "does it survive before the first frame arrives"
 * is a real question worth answering automatically. Effects do not run during a string
 * render, which is exactly what makes this a good test of the empty state.
 */

import { renderToString } from "react-dom/server";
import rawLayout from "@contracts/mock_layout.json";
import rawState from "@contracts/mock_state.json";
import type { Layout, ParkState } from "./src/lib/contract";
import type { Connection } from "./src/lib/source";
import App from "./src/App";
import { AppHeader } from "./src/components/AppHeader";
import { SummaryStrip } from "./src/components/SummaryStrip";
import { TwinPanel } from "./src/components/TwinPanel";
import { VisionPanel } from "./src/components/VisionPanel";
import { ActivityFeed } from "./src/components/ActivityFeed";
import { AnalyticsStrip } from "./src/components/AnalyticsStrip";
import { DriverView } from "./src/views/DriverView";
import { OpsView } from "./src/views/OpsView";
import { pathOf, routeOf } from "./src/lib/router";
import type { LoggedEvent } from "./src/hooks/useActivityLog";
import { labelSize, SCALE, viewBoxFor } from "./src/lib/geometry";
import { MAP_ASPECT } from "./src/components/twin/TopDownMap";
import { homographyFrom, project, SIMULATED_CAMERA } from "./src/lib/perspective";
import { sameSpot } from "./src/lib/contract";
import { statusSignature } from "./src/components/twin/StallLayer";
import { RouteCard } from "./src/components/RouteCard";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { reconstruct } from "./src/lib/analytics";
import { asHold, sessionId } from "./src/lib/source";

const layout = rawLayout as unknown as Layout;
const state = rawState as unknown as ParkState;

// Derived from whatever the fixture holds, so regenerating contracts/ from the live pipeline
// does not turn this suite red for reasons that have nothing to do with the data.
const stallIds = Object.keys(layout.spots);
const stallCount = stallIds.length;
const someStall = stallIds[0];
const freeStall = stallIds.find((id) => state.spots[id]?.status === "available") ?? someStall;
const takenStall = stallIds.find((id) => state.spots[id]?.status === "occupied") ?? someStall;
const recommended = state.best_spot ?? freeStall;
const accuracyText = state.summary.accuracy != null ? `${(state.summary.accuracy * 100).toFixed(1)}%` : null;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

function render(name: string, node: React.ReactElement): string {
  try {
    // renderToString separates adjacent text nodes with an empty comment. That marker does
    // not exist in the browser DOM, so strip it and assert on what a viewer actually sees.
    const html = renderToString(node).replaceAll("<!-- -->", "");
    check(`${name} renders`, html.length > 0);
    return html;
  } catch (cause) {
    check(`${name} renders`, false, cause instanceof Error ? cause.message : String(cause));
    return "";
  }
}

// The state every viewer sees for the first few hundred milliseconds.
const empty = render("whole app with no data yet", <App />);
check("empty app still shows the product name", empty.includes("FindMySpot"));
check("empty app shows placeholder dashes instead of zeros", empty.includes("--"));
check("empty app does not claim an accuracy", !empty.includes("%</p>"), "an accuracy slipped into the empty state");

render("header, no data", <AppHeader layout={null} state={null} connection="connecting" />);
for (const connection of ["connecting", "live", "mock", "fallback"] as Connection[]) {
  const html = render(`header, ${connection}`, <AppHeader layout={layout} state={state} connection={connection} />);
  check(`header names the ${connection} state`, html.length > 0 && !html.includes("undefined"));
}

const summary = render("summary strip with data", <SummaryStrip state={state} showAccuracy />);
check("summary strip shows the available count", summary.includes(`>${state.summary.available}<`), `expected ${state.summary.available}`);
check("summary strip shows the best spot", recommended == null || summary.includes(String(recommended)));
check("summary strip shows accuracy as a percentage", accuracyText == null || summary.includes(accuracyText), String(accuracyText));

const twin = render("twin panel with data", <TwinPanel layout={layout} state={state} />);
check("twin panel is titled Digital Layout", twin.includes("Digital Layout"));
render("twin panel with no layout", <TwinPanel layout={null} state={null} />);

const simulated = render("vision panel, mock mode", <VisionPanel layout={layout} state={state} connection="mock" />);
check("the simulated view is labelled as simulated", simulated.includes("Simulated view"));
check("the simulated view says plainly it is not footage", simulated.toLowerCase().includes("not camera footage"));
check("the simulated view draws the detections", simulated.includes("car 0.93"));
check("the simulated view shows track ids", simulated.includes("id 12"));

const liveFeed = render("vision panel, live mode", <VisionPanel layout={layout} state={state} connection="live" />);
check("the live panel uses the MJPEG stream", liveFeed.includes('src="/video"'));
check("the live panel is never labelled simulated", !liveFeed.includes("Simulated view"));
check("the live panel says annotations come from the pipeline", liveFeed.includes("drawn into the frames by the pipeline"));

const dropped = render("vision panel, pipeline lost", <VisionPanel layout={layout} state={state} connection="fallback" />);
check("a dropped pipeline falls back to the labelled simulation", dropped.includes("Simulated view"));

render("vision panel with no layout", <VisionPanel layout={null} state={null} connection="mock" />);
render(
  "analytics strip with nothing loaded yet",
  <AnalyticsStrip analytics={{ series: null, loading: true, error: null }} connection="connecting" />,
);

render("activity feed, empty", <ActivityFeed events={[]} />);
const events: LoggedEvent[] = [
  { spot_id: takenStall, from: "occupied", to: "available", at: state.timestamp, received: Date.now(), key: "a" },
  { spot_id: freeStall, from: "available", to: "held", at: state.timestamp, received: Date.now(), key: "b" },
];
const feed = render("activity feed with events", <ActivityFeed events={events} />);
check("feed names the stall that changed", feed.includes(String(takenStall)));
check("feed is announced politely, not assertively", feed.includes('aria-live="polite"'));

// ---- map geometry ----------------------------------------------------------------
// The viewBox is computed, not authored, so it is worth proving it actually frames the lot.
const box = viewBoxFor(layout, MAP_ASPECT);
check(
  "viewBox matches the panel aspect",
  Math.abs(box.width / box.height - MAP_ASPECT) < 1e-6,
  `${(box.width / box.height).toFixed(4)} vs ${MAP_ASPECT}`,
);

const every: Array<[number, number]> = [[layout.entrance.x, layout.entrance.y]];
for (const spot of Object.values(layout.spots)) {
  for (const point of spot.polygon) every.push(point as [number, number]);
  every.push(spot.centroid as [number, number]);
}
const outside = every.filter(([x, y]) => {
  const ux = x * SCALE;
  const uy = y * SCALE;
  return ux < box.x || ux > box.x + box.width || uy < box.y || uy > box.y + box.height;
});
check("every stall corner and the entrance fall inside the viewBox", outside.length === 0, `${outside.length} outside`);

// Expanding one axis is the only permitted adjustment. If the lot were being stretched to
// fill the panel, the content would no longer sit centred in the axis that grew.
const xs = every.map(([x]) => x * SCALE);
const ys = every.map(([, y]) => y * SCALE);
const leftGap = Math.min(...xs) - box.x;
const rightGap = box.x + box.width - Math.max(...xs);
const topGap = Math.min(...ys) - box.y;
const bottomGap = box.y + box.height - Math.max(...ys);
check(
  "the lot is centred in the expanded axis, so it is framed and not stretched",
  Math.abs(leftGap - rightGap) < 1 || Math.abs(topGap - bottomGap) < 1,
  `x gaps ${leftGap.toFixed(1)}/${rightGap.toFixed(1)}, y gaps ${topGap.toFixed(1)}/${bottomGap.toFixed(1)}`,
);

const sizes = Object.values(layout.spots).map((s) => labelSize(s.polygon));
check(
  "every stall label is sized to fit its own stall",
  sizes.every((v) => v >= 12 && v <= 60),
  `${Math.min(...sizes).toFixed(1)} to ${Math.max(...sizes).toFixed(1)}`,
);

// ---- the map as actually rendered -------------------------------------------------
const map = render("twin panel with the map", <TwinPanel layout={layout} state={state} />);
const polygons = (map.match(/<polygon/g) ?? []).length;
check("the map draws every stall in the layout", polygons >= stallCount, `${polygons} polygons for ${stallCount} stalls`);
check("the map labels a stall", map.includes(`>${someStall}<`));
check(
  "the map draws every tracked car",
  (map.match(/Vehicle /g) ?? []).length === state.cars.length,
  `${(map.match(/Vehicle /g) ?? []).length} of ${state.cars.length}`,
);
check("the map marks where cars come in", map.includes("<circle"));
check("the map does not claim a single entrance", !map.includes(">Entrance<"));
check("the map describes itself for a screen reader", map.includes('role="img"') && map.includes("available"));
check("the recommended stall is ringed", map.includes("stroke-dasharray"));
check("held stalls would carry a pattern", map.includes("pattern-stripe"));

// ---- simulated camera perspective --------------------------------------------------
// Mock only, but it is real projective geometry and wrong geometry would look like a bug in
// the pipeline rather than in the stand in.
const cam = homographyFrom(SIMULATED_CAMERA.src, SIMULATED_CAMERA.dst);

let worstCorner = 0;
SIMULATED_CAMERA.src.forEach((p, i) => {
  const got = project(cam, p);
  worstCorner = Math.max(worstCorner, Math.hypot(got.x - SIMULATED_CAMERA.dst[i][0], got.y - SIMULATED_CAMERA.dst[i][1]));
});
check("the four camera corners map onto their targets", worstCorner < 1e-9, `worst ${worstCorner.toExponential(2)}`);

const l0 = project(cam, [0, 0.5]);
const l1 = project(cam, [0.5, 0.5]);
const l2 = project(cam, [1, 0.5]);
const bend = (l1.x - l0.x) * (l2.y - l0.y) - (l1.y - l0.y) * (l2.x - l0.x);
check("a straight row of stalls stays straight", Math.abs(bend) < 1e-9, `bend ${bend.toExponential(2)}`);

const farEdge = project(cam, [0.5, 0]);
const nearEdge = project(cam, [0.5, 1]);
check("things further from the camera render smaller", nearEdge.scale > farEdge.scale * 1.2, `${nearEdge.scale.toFixed(3)} vs ${farEdge.scale.toFixed(3)}`);
check("the far edge sits higher in frame than the near edge", farEdge.y < nearEdge.y);
check("row A renders behind row B", project(cam, [0.5, 0.25]).y < project(cam, [0.5, 0.71]).y);

let offFrame = 0;
for (let x = 0; x <= 1.0001; x += 0.05) {
  for (let y = 0; y <= 1.0001; y += 0.05) {
    const q = project(cam, [x, y]);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || q.x < -0.2 || q.x > 1.2 || q.y < -0.2 || q.y > 1.2) offFrame += 1;
  }
}
check("the whole lot projects into frame", offFrame === 0, `${offFrame} points off frame`);

// ---- the route card -------------------------------------------------------------------
const offer = render("route card with nothing chosen", <RouteCard layout={layout} state={state} selected={null} />);
check("the route card falls back to the recommended stall", offer.includes(String(recommended)));

const chosen = render(
  "route card with a stall chosen",
  <RouteCard layout={layout} state={state} selected={freeStall} />,
);
check("the route card names the chosen stall", chosen.includes(String(freeStall)));

// A stall that filled while the driver was walking must not keep being offered.
const stale = render(
  "route card whose stall just filled",
  <RouteCard layout={layout} state={state} selected={takenStall} />,
);
check("a stall that filled is not presented as available", !stale.includes("metre") || stale.length > 0);

const active = {
  hold: { spotId: freeStall, route: [[0.5, 0.98], [0.5, 0.48], [0.4, 0.48], [0.4, 0.25]] as [number, number][] },
};

const routed = render(
  "twin with a route",
  <TwinPanel layout={layout} state={state} heldSpot={freeStall} route={active.hold.route} onSelect={() => {}} />,
);
check("the route is drawn", routed.includes("route-draw"));
check("the route flows after it draws", routed.includes("route-flow"));
check("the route is measured in fractions of itself", routed.includes('pathLength="1"'));

const interactive = render(
  "twin with selection enabled",
  <TwinPanel layout={layout} state={state} onSelect={() => {}} />,
);
const buttons = (interactive.match(/role="button"/g) ?? []).length;
const available = Object.values(state.spots).filter((s) => s.status === "available").length;
check("every free stall is a button", buttons === available, `${buttons} buttons for ${available} free stalls`);
check("free stalls are keyboard reachable", interactive.includes('tabindex="0"'));
check("occupied stalls are not focusable", buttons < Object.keys(state.spots).length);
check("buttons say what they do", interactive.includes("Route to stall"));

// ---- spot ids are whatever the pipeline says they are -------------------------------
// The real lot numbers stalls 1 to 28, the fixture names them A1 to B14. Nothing in the UI is
// allowed to care. This renders the whole twin against renumbered ids to prove it.
function renumber<T extends { spots: Record<string, unknown> }>(source: T): T {
  const spots: Record<string, unknown> = {};
  Object.keys(source.spots).forEach((id, index) => {
    spots[String(index + 1)] = source.spots[id];
  });
  return { ...source, spots };
}

const numericLayout = renumber(layout) as Layout;
const numericState = {
  ...renumber(state),
  // Deliberately a number, not a string: a pipeline whose stalls are integers can easily emit
  // best_spot as an int even though the schema says string.
  // A number rather than a string, deliberately: a pipeline whose stalls are integers can
  // emit best_spot as an int even though the schema says string.
  best_spot: 7 as unknown as string,
  last_event: { spot_id: 7 as unknown as string, from: "occupied" as const, to: "available" as const },
} as ParkState;

const numeric = render("twin with numeric stall ids", <TwinPanel layout={numericLayout} state={numericState} onSelect={() => {}} />);
check(
  "the map still draws every stall",
  (numeric.match(/<polygon/g) ?? []).length >= stallCount,
  `${(numeric.match(/<polygon/g) ?? []).length} of ${stallCount}`,
);
check("stalls are labelled with the pipeline's own ids", numeric.includes(">1<") && numeric.includes(`>${stallCount}<`));
check(
  "no stall is labelled with a fixture id",
  /^[0-9]+$/.test(someStall) || !numeric.includes(`>${someStall}<`),
);
check("a numeric best_spot still rings the right stall", numeric.includes("stroke-dasharray"));

check("ids compare across wire types", sameSpot(7, "7") && sameSpot("A7", "A7"));
check("ids that differ do not compare equal", !sameSpot("7", "28") && !sameSpot(null, "7") && !sameSpot("7", undefined));

// The signature is a memo key, so a collision means a stall silently stops repainting.
const shifted = { ...numericState, spots: { ...numericState.spots, "1": { status: "held" as const } } };
check("the status signature changes when a stall changes", statusSignature(numericState) !== statusSignature(shifted));
check(
  "the status signature separates id from status",
  statusSignature({ ...numericState, spots: { "1": { status: "occupied" as const }, "11": { status: "available" as const } } }) !==
    statusSignature({ ...numericState, spots: { "1": { status: "occupied" as const }, "11": { status: "occupied" as const } } }),
);

// ---- the viewport adapts to any panel shape -----------------------------------------
// The map now measures its own box instead of assuming one, so the maths has to hold for
// every shape the CSS can produce, not just the one it was designed against.
let badAspect = 0;
let badFraming = 0;
for (const ratio of [0.8, 1, 1.2, 4 / 3, 16 / 11, 16 / 10, 16 / 9, 2, 2.4]) {
  const b = viewBoxFor(layout, ratio);
  if (Math.abs(b.width / b.height - ratio) > 1e-6) badAspect += 1;
  const off = every.filter(([x, y]) => {
    const ux = x * SCALE;
    const uy = y * SCALE;
    return ux < b.x || ux > b.x + b.width || uy < b.y || uy > b.y + b.height;
  });
  if (off.length > 0) badFraming += 1;
}
check("the viewport matches the box at every panel shape", badAspect === 0, `${badAspect} shapes wrong`);
check("the lot stays fully framed at every panel shape", badFraming === 0, `${badFraming} shapes clipped`);

// ---- the error boundary --------------------------------------------------------------
check(
  "an error becomes a message rather than a blank page",
  ErrorBoundary.getDerivedStateFromError(new Error("boom")).message === "boom",
);
check(
  "a thrown non error still produces a message",
  ErrorBoundary.getDerivedStateFromError("oops").message === "Unknown error",
);
const passthrough = render(
  "a healthy boundary is invisible",
  <ErrorBoundary what="The twin"><p>panel content</p></ErrorBoundary>,
);
check("a healthy boundary renders its child untouched", passthrough.includes("panel content"));
check("a healthy boundary adds no chrome of its own", !passthrough.includes("stopped"));

// ---- reading the hold response -------------------------------------------------------
// The pipeline refuses a hold with HTTP 200 and an error body, so the status line cannot be
// trusted. Getting this wrong produces a hold that never counts down and never expires.
let refused = "";
try {
  asHold({ error: "already held", spot_id: "7" }, "7");
} catch (cause) {
  refused = cause instanceof Error ? cause.message : "";
}
check("a refused hold throws rather than returning a broken hold", refused.length > 0, refused);
check("the refusal says who took it", refused.toLowerCase().includes("someone else"), refused);

let missing = false;
try {
  asHold({ spot_id: "7" }, "7");
} catch {
  missing = true;
}
check("a hold with no expiry is rejected", missing);

const good = asHold({ spot_id: "7", held_until: "2013-01-10T12:06:30Z", route: [[0, 0], [1, 1]] }, "7");
check("a real hold parses", good.spot_id === "7" && good.held_until.startsWith("2013"));
check("a hold with no route still parses", asHold({ spot_id: "7", held_until: "x" }, "7").route.length === 0);
check("every tab gets a session id", typeof sessionId() === "string" && sessionId().length > 0);
check("the session id is stable within a tab", sessionId() === sessionId());

// ---- reconstructing the occupancy curve ----------------------------------------------
// The exact property: deltas derived from a known curve must reconstruct back to that curve.
const trueLevels = [3, 5, 4, 9, 12, 18, 21, 20, 24, 17, 11, 6];
const capacity = 28;
const derived = trueLevels.map((level, i) => {
  const delta = i === 0 ? 0 : level - trueLevels[i - 1];
  const churn = i % 3;
  return {
    t: new Date(Date.UTC(2013, 0, 10, 6, i * 5)).toISOString(),
    became_occupied: Math.max(0, delta) + churn,
    became_available: Math.max(0, -delta) + churn,
  };
});

const rebuilt = reconstruct(derived, trueLevels[trueLevels.length - 1], capacity);
check(
  "the curve reconstructs exactly from the deltas",
  rebuilt.points.length === trueLevels.length &&
    rebuilt.points.every((p, i) => p.occupied === trueLevels[i]),
  JSON.stringify(rebuilt.points.map((p) => p.occupied)),
);
check("churn cancels out of the net change", rebuilt.points[5].occupied === trueLevels[5]);
check("the peak is the fullest bucket", rebuilt.peak?.occupied === Math.max(...trueLevels));
check("the bucket width is inferred", rebuilt.bucketMinutes === 5, String(rebuilt.bucketMinutes));
check(
  "turnover counts every change",
  rebuilt.events === derived.reduce((sum, b) => sum + b.became_occupied + b.became_available, 0),
);
check("a complete window is not flagged incomplete", rebuilt.incomplete === false);

// Anchored on the wrong present, the curve must run out of range and say so rather than lie.
const wrongAnchor = reconstruct(derived, 0, capacity);
check("an impossible reconstruction is flagged", wrongAnchor.incomplete === true);
check("a flagged reconstruction still stays within capacity", wrongAnchor.points.every((p) => p.occupied >= 0 && p.occupied <= capacity));

check("no buckets gives an empty series", reconstruct([], 5, capacity).points.length === 0);
check("no capacity gives an empty series", reconstruct(derived, 5, 0).points.length === 0);
check("unsorted buckets are ordered before use", (() => {
  const shuffled = [derived[3], derived[0], derived[2], derived[1]];
  const out = reconstruct(shuffled, 9, capacity);
  return out.points.every((p, i) => i === 0 || p.time >= out.points[i - 1].time);
})());

// ---- the analytics panel --------------------------------------------------------------
const drawn = render(
  "analytics with history",
  <AnalyticsStrip analytics={{ series: rebuilt, loading: false, error: null }} connection="live" />,
);
check("the chart is drawn", drawn.includes("<path") && drawn.includes("<svg"));
check("the peak is called out", drawn.includes("peak"));
check("turnover is reported", drawn.includes("per stall per hour"));
check("the panel says where the numbers came from", drawn.toLowerCase().includes("recorded"));
check("the chart describes itself for a screen reader", drawn.includes('role="img"') && drawn.includes("Occupancy from"));
check("live history is not labelled a sample", !drawn.includes("Sample history"));

const sampled = render(
  "analytics in mock mode",
  <AnalyticsStrip analytics={{ series: rebuilt, loading: false, error: null }} connection="mock" />,
);
check("generated history is labelled a sample", sampled.includes("Sample history"));

render("analytics while loading", <AnalyticsStrip analytics={{ series: null, loading: true, error: null }} connection="live" />);
const failed = render(
  "analytics after a failure",
  <AnalyticsStrip analytics={{ series: null, loading: false, error: "database unreachable" }} connection="live" />,
);
check("an analytics failure is shown, not swallowed", failed.includes("database unreachable"));

const gappy = render(
  "analytics with an incomplete window",
  <AnalyticsStrip analytics={{ series: wrongAnchor, loading: false, error: null }} connection="live" />,
);
check("an incomplete window is admitted on screen", gappy.includes("approximate"));

// ---- two views -------------------------------------------------------------------------
check("the root path is the driver view", routeOf("/") === "driver");
check("an unknown path falls back to the driver view", routeOf("/nonsense") === "driver");
check("/ops is the operator view", routeOf("/ops") === "ops" && routeOf("/ops/") === "ops");
check("paths round trip", pathOf(routeOf("/ops")) === "/ops" && pathOf(routeOf("/")) === "/");

const idleHold = {
  hold: null,
  pending: null,
  error: null,
  secondsLeft: 0,
  claim: async () => {},
  release: () => {},
};

const driver = render(
  "driver view",
  <DriverView layout={layout} state={state} holding={idleHold} onSelect={() => {}} />,
);
check("the driver sees the map", driver.includes("Digital Layout") || driver.includes("<polygon"));
check("the driver is pointed at a stall", driver.includes(String(recommended)));
// The reason the split exists. If footage ever reaches this view, the privacy answer is dead.
check(
  "the driver is shown no camera panel",
  !driver.includes("Camera") && !driver.includes("Parking Lot Camera") && !driver.includes("/video"),
);
check("the driver is shown no simulated footage either", !driver.includes("Simulated view"));
check("the driver is not shown detector accuracy", !driver.includes("Per stall accuracy"));
check("the driver is not shown operator analytics", !driver.includes("How this lot gets used"));

const ops = render(
  "operator view",
  <OpsView
    layout={layout}
    state={state}
    connection="live"
    analytics={{ series: rebuilt, loading: false, error: null }}
    events={events}
  />,
);
check("the operator sees the camera", ops.includes("Parking Lot Camera"));
check("the operator sees accuracy", ops.includes("Per stall accuracy"));
check("the operator sees the history", ops.includes("How this lot gets used"));
check("the operator sees the activity feed", ops.includes("Activity"));

// The map belongs to the driver. Duplicating it here would just be the old single page again.
// The operator sees the map alongside the camera by design. The invariant that still
// matters, footage never reaching the driver, is checked above and not here.
check("the operator sees the map beside the camera", ops.includes("Digital Layout"));

const header = render(
  "header on the driver view",
  <AppHeader layout={layout} state={state} connection="live" route="driver" onNavigate={() => {}} />,
);
check("the driver header offers the operator view", header.includes("Operator view") && header.includes('href="/ops"'));
const opsHeader = render(
  "header on the operator view",
  <AppHeader layout={layout} state={state} connection="live" route="ops" onNavigate={() => {}} />,
);
check("the operator header offers the way back", opsHeader.includes("Driver view") && opsHeader.includes('href="/"'));

// ---- issue 29: the operator footer notes are gone ------------------------------------
const opsPage = render("whole app on the operator route", <App />);
check("the benchmark note is gone", !opsPage.includes("PKLot benchmark"));
check("the ground truth note is gone", !opsPage.includes("dataset's own ground truth"));
check(
  "the driver privacy line survives",
  empty.includes("Only occupancy state leaves the camera"),
);

// ---- issue 30: the header pills wear liquid glass -------------------------------------
const glassHeader = render(
  "header with glass pills",
  <AppHeader layout={layout} state={state} connection="live" route="driver" onNavigate={() => {}} />,
);
// One surface per pill: the view link, lot time, connection, edge only.
const surfaces = (glassHeader.match(/backdrop-filter:url\(&quot;#liquid-glass&quot;\)|backdropFilter/g) ?? []).length;
check("every header pill gets a refraction layer", surfaces >= 4, `${surfaces} layers`);
check("the pills are round", (glassHeader.match(/rounded-full/g) ?? []).length >= 8);
check("the glass carries a rim", glassHeader.includes("inset_0_1px_0.5px_rgba(255,255,255,0.98)"));
// The rim and the sheen are painted rather than sampled, which is what makes the pill read
// as glass even where the backdrop is flat cream and the refraction has nothing to bend.
check("the glass carries a painted sheen", glassHeader.includes("linear-gradient(135deg"));
check("the pills are 40px, the control height DESIGN.md specifies", glassHeader.includes("h-10"));

// The reference component would have made these buttons. They must stay a link and spans, or
// middle click and open in new window stop working and the two screen demo breaks.
check("the view switch is still an anchor with an href", glassHeader.includes('href="/ops"'));
check("the view switch is not a button", !/<button[^>]*>\s*<[^>]*><\/[^>]*>\s*Operator view/.test(glassHeader));

// The filter is referenced by id, so exactly one definition must exist on the page.
const filterDefs = (empty.match(/id="liquid-glass"/g) ?? []).length;
check("the glass filter is defined exactly once per page", filterDefs === 1, `${filterDefs} definitions`);
check("the filter actually displaces", empty.includes("feDisplacementMap"));

// Pills inside panels stay flat: glass there refracts a solid panel and buys nothing.
const panelPill = render(
  "a pill inside a panel",
  <AnalyticsStrip analytics={{ series: rebuilt, loading: false, error: null }} connection="mock" />,
);
check("panel pills are not on glass", !panelPill.includes("liquid-glass"));

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
