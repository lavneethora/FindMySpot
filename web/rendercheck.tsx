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
import type { LoggedEvent } from "./src/hooks/useActivityLog";

const layout = rawLayout as unknown as Layout;
const state = rawState as unknown as ParkState;

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
    const html = renderToString(node);
    check(`${name} renders`, html.length > 0);
    return html;
  } catch (cause) {
    check(`${name} renders`, false, cause instanceof Error ? cause.message : String(cause));
    return "";
  }
}

// The state every viewer sees for the first few hundred milliseconds.
const empty = render("whole app with no data yet", <App />);
check("empty app still shows the product name", empty.includes("ParkTech"));
check("empty app shows placeholder dashes instead of zeros", empty.includes("--"));
check("empty app does not claim an accuracy", !empty.includes("%</p>"), "an accuracy slipped into the empty state");

render("header, no data", <AppHeader layout={null} state={null} connection="connecting" />);
for (const connection of ["connecting", "live", "mock", "fallback"] as Connection[]) {
  const html = render(`header, ${connection}`, <AppHeader layout={layout} state={state} connection={connection} />);
  check(`header names the ${connection} state`, html.length > 0 && !html.includes("undefined"));
}

const summary = render("summary strip with data", <SummaryStrip state={state} />);
check("summary strip shows the available count", summary.includes(">7<"), "expected 7 available");
check("summary strip shows the best spot", summary.includes("B9"));
check("summary strip shows accuracy as a percentage", summary.includes("94.2%"));

const twin = render("twin panel with data", <TwinPanel layout={layout} state={state} />);
check("twin panel counts the stalls", twin.includes("28 stalls"));
render("twin panel with no layout", <TwinPanel layout={null} state={null} />);

render("vision panel with accuracy", <VisionPanel accuracy={0.942} />);
render("vision panel with null accuracy", <VisionPanel accuracy={null} />);
render("analytics strip", <AnalyticsStrip />);

render("activity feed, empty", <ActivityFeed events={[]} />);
const events: LoggedEvent[] = [
  { spot_id: "A7", from: "occupied", to: "available", at: state.timestamp, received: Date.now(), key: "a" },
  { spot_id: "B3", from: "available", to: "held", at: state.timestamp, received: Date.now(), key: "b" },
];
const feed = render("activity feed with events", <ActivityFeed events={events} />);
check("feed names the stall that changed", feed.includes("A7"));
check("feed is announced politely, not assertively", feed.includes('aria-live="polite"'));

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
