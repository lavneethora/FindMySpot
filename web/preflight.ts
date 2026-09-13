/**
 * Preflight against a running pipeline.
 *
 *     npm run check:live                        # expects the pipeline on :8100
 *     PARKTECH_ORIGIN=http://host:9000 npm run check:live
 *
 * Everything else in this repo is tested against the fixture. This is the one that talks to
 * the real thing, and it exists because the two lanes have never run together: every bug found
 * so far at the seam was invisible in mock mode.
 *
 * It answers, in about five seconds, the questions that otherwise cost half an hour with two
 * people and one laptop. Are the endpoints there. Do the stall ids in the layout match the
 * ones in the state. Are coordinates actually normalised. Does a hold come back with an
 * expiry, and does a second driver get refused. Does the analytics payload reconstruct into a
 * curve.
 *
 * Read only apart from one hold, which the pipeline expires by itself.
 */

import net from "node:net";
import crypto from "node:crypto";
import type { Analytics, Layout, ParkState } from "./src/lib/contract";
import { reconstruct } from "./src/lib/analytics";

const ORIGIN = process.env.PARKTECH_ORIGIN ?? "http://localhost:8100";
const TIMEOUT = 8000;

let failures = 0;
let warnings = 0;

function ok(name: string, detail = "") {
  console.log(`  ok    ${name}${detail ? `  ${detail}` : ""}`);
}
function bad(name: string, detail = "") {
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ""}`);
}
function warn(name: string, detail = "") {
  warnings += 1;
  console.log(`  warn  ${name}${detail ? `  ${detail}` : ""}`);
}
function check(name: string, passed: boolean, detail = "") {
  if (passed) ok(name, detail);
  else bad(name, detail);
}

function normalised(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${ORIGIN}${path}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return (await response.json()) as T;
}

console.log(`\nParkTech preflight against ${ORIGIN}\n`);

// ---- is anything listening -------------------------------------------------------------
try {
  await fetch(`${ORIGIN}/api/state`, { signal: AbortSignal.timeout(3000) });
  ok("the pipeline is reachable");
} catch (cause) {
  bad("the pipeline is reachable", cause instanceof Error ? cause.message : String(cause));
  console.log(
    `\nNothing is answering on ${ORIGIN}.\n` +
      "Start it with `python run.py` on the vision machine, and check the port: run.py\n" +
      "defaults to 8100. Set PARKTECH_ORIGIN if it is somewhere else.\n",
  );
  process.exit(1);
}

// ---- layout ------------------------------------------------------------------------------
let layout: Layout | null = null;
try {
  layout = await getJson<Layout>("/api/layout");
  ok("GET /api/layout answers");
} catch (cause) {
  bad("GET /api/layout answers", cause instanceof Error ? cause.message : String(cause));
}

let layoutIds: string[] = [];
if (layout) {
  layoutIds = Object.keys(layout.spots ?? {});
  check("the layout has stalls", layoutIds.length > 0, `${layoutIds.length}`);
  check(
    "the entrance is in normalised coordinates",
    normalised(layout.entrance?.x) && normalised(layout.entrance?.y),
    JSON.stringify(layout.entrance),
  );

  const badPolys = layoutIds.filter((id) => {
    const spot = layout!.spots[id];
    return !Array.isArray(spot?.polygon) || spot.polygon.length < 3;
  });
  check("every stall has a polygon of at least three points", badPolys.length === 0, badPolys.slice(0, 5).join(", "));

  // The single most likely thing to be wrong at first contact. If the homography emits pixels
  // rather than 0..1, every stall renders in the top left corner and the map looks empty.
  const offScale = layoutIds.filter((id) => {
    const spot = layout!.spots[id];
    return (spot?.polygon ?? []).some((p) => !normalised(p?.[0]) || !normalised(p?.[1]));
  });
  check(
    "every stall polygon is normalised 0 to 1",
    offScale.length === 0,
    offScale.length ? `${offScale.length} stalls out of range, e.g. ${JSON.stringify(layout.spots[offScale[0]].polygon[0])}` : "",
  );

  const noCentroid = layoutIds.filter((id) => {
    const c = layout!.spots[id]?.centroid;
    return !Array.isArray(c) || c.length < 2;
  });
  check("every stall has a centroid", noCentroid.length === 0, noCentroid.slice(0, 5).join(", "));

  const noDistance = layoutIds.filter((id) => typeof layout!.spots[id]?.distance_to_entrance_m !== "number");
  if (noDistance.length > 0) {
    warn(
      "distance_to_entrance_m is missing on some stalls",
      `${noDistance.length} of ${layoutIds.length}. Optional, but the map cannot rank stalls without it`,
    );
  } else {
    ok("every stall carries a walking distance");
  }
}

// ---- state -------------------------------------------------------------------------------
let state: ParkState | null = null;
try {
  state = await getJson<ParkState>("/api/state");
  ok("GET /api/state answers");
} catch (cause) {
  bad("GET /api/state answers", cause instanceof Error ? cause.message : String(cause));
}

function validateState(where: string, s: ParkState) {
  const ids = Object.keys(s.spots ?? {});
  check(`${where}: has stalls`, ids.length > 0, `${ids.length}`);

  if (layoutIds.length > 0) {
    const missing = layoutIds.filter((id) => !(id in (s.spots ?? {})));
    const extra = ids.filter((id) => !layoutIds.includes(id));
    // The classic cross lane failure: the frontend renders geometry it has no status for, or
    // holds status for stalls it cannot draw. Either way stalls silently vanish.
    check(
      `${where}: stall ids match the layout exactly`,
      missing.length === 0 && extra.length === 0,
      missing.length || extra.length ? `${missing.length} missing, ${extra.length} unknown, e.g. ${[...missing, ...extra].slice(0, 4).join(", ")}` : "",
    );
  }

  const validStatus = ["occupied", "available", "held"];
  const oddStatus = ids.filter((id) => !validStatus.includes(s.spots[id]?.status));
  check(`${where}: every status is one the UI knows`, oddStatus.length === 0, oddStatus.slice(0, 4).join(", "));

  const offScaleCars = (s.cars ?? []).filter((c) => !normalised(c?.x) || !normalised(c?.y));
  check(
    `${where}: vehicle positions are normalised 0 to 1`,
    offScaleCars.length === 0,
    offScaleCars.length ? `${offScaleCars.length} off scale, e.g. ${JSON.stringify(offScaleCars[0])}` : `${(s.cars ?? []).length} tracked`,
  );

  const held = ids.filter((id) => s.spots[id].status === "held").length;
  const occupied = ids.filter((id) => s.spots[id].status === "occupied").length;
  check(
    `${where}: the summary matches the stalls`,
    s.summary?.total === ids.length && s.summary?.occupied === occupied,
    `summary says ${s.summary?.occupied}/${s.summary?.total}, stalls say ${occupied}/${ids.length}, ${held} held`,
  );

  if (typeof s.timestamp === "string" && Number.isFinite(Date.parse(s.timestamp))) {
    ok(`${where}: the timestamp parses`, new Date(s.timestamp).toISOString());
  } else {
    bad(`${where}: the timestamp parses`, String(s.timestamp));
  }

  if (s.best_spot != null && !ids.includes(String(s.best_spot))) {
    bad(`${where}: best_spot names a real stall`, String(s.best_spot));
  } else if (s.best_spot != null) {
    ok(`${where}: best_spot names a real stall`, String(s.best_spot));
  }
}

if (state) validateState("state", state);

// ---- websocket ---------------------------------------------------------------------------
/**
 * Speak the handshake directly, so a failure can be attributed.
 *
 * The check below uses the same WebSocket client the browser does, which is the thing that has
 * to work. But when that refuses, "nothing arrived" does not say whether the endpoint is
 * missing, the handshake is malformed, or the client is being stricter than the server. This
 * answers that, and costs one short-lived socket.
 */
function rawUpgrade(): Promise<{ status: number; acceptOk: boolean } | null> {
  const CRLF = "\r\n";
  return new Promise((resolve) => {
    const url = new URL(ORIGIN);
    const key = crypto.randomBytes(16).toString("base64");
    const expect = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-5AB0DC85B11F")
      .digest("base64");

    const socket = net.connect(Number(url.port || 80), url.hostname);
    let head = "";
    let settled = false;
    const done = (value: { status: number; acceptOk: boolean } | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(4000, () => done(null));
    socket.on("error", () => done(null));
    socket.on("connect", () => {
      socket.write(
        [
          "GET /ws HTTP/1.1",
          `Host: ${url.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join(CRLF),
      );
    });
    socket.on("data", (chunk) => {
      head += chunk.toString("latin1");
      if (!head.includes(CRLF + CRLF)) return;
      const status = Number(head.slice(9, 12));
      const accept = /sec-websocket-accept:\s*(\S+)/i.exec(head)?.[1] ?? "";
      done({ status, acceptOk: accept === expect });
    });
  });
}

const raw = await rawUpgrade();
if (!raw) {
  bad("/ws accepts a WebSocket handshake", "the socket closed without answering");
} else if (raw.status !== 101) {
  bad("/ws accepts a WebSocket handshake", `answered ${raw.status}, expected 101. Is the route mounted?`);
} else {
  ok("/ws accepts a WebSocket handshake", "101 Switching Protocols");
  check("the handshake key is answered correctly", raw.acceptOk, raw.acceptOk ? "" : "Sec-WebSocket-Accept does not match the key we sent");
}

const pushed = await new Promise<ParkState | null>((resolve) => {
  let settled = false;
  const socket = new WebSocket(`${ORIGIN.replace(/^http/, "ws")}/ws`);
  const done = (value: ParkState | null) => {
    if (settled) return;
    settled = true;
    try {
      socket.close();
    } catch {
      // already closing
    }
    resolve(value);
  };
  const timer = setTimeout(() => done(null), TIMEOUT);
  socket.onmessage = (event) => {
    clearTimeout(timer);
    try {
      done(JSON.parse(String(event.data)) as ParkState);
    } catch {
      done(null);
    }
  };
  socket.onerror = () => {
    clearTimeout(timer);
    done(null);
  };
});

if (pushed) {
  ok("a browser style client receives a state on connect");
  validateState("ws", pushed);
} else if (raw && raw.status === 101 && raw.acceptOk) {
  // Worth separating: the endpoint is fine, so this is about the handshake's finer points or
  // about nothing being pushed, not about a missing route.
  warn(
    "a browser style client received no state within " + TIMEOUT + "ms",
    "the handshake itself is correct, so either nothing is pushed on connect or the server " +
      "declines an option the client requires, commonly the permessage-deflate extension",
  );
} else {
  bad("a browser style client receives a state on connect", "and the raw handshake did not succeed either");
}

// ---- video --------------------------------------------------------------------------------
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const response = await fetch(`${ORIGIN}/video`, { signal: controller.signal });
  const type = response.headers.get("content-type") ?? "";
  check("GET /video is an MJPEG stream", type.includes("multipart/x-mixed-replace"), type || "no content-type");

  const reader = response.body?.getReader();
  if (reader) {
    const { value } = await reader.read();
    const bytes = value?.length ?? 0;
    // The panel renders this straight into an <img>, so an empty stream is a blank panel.
    check("the stream is actually sending frames", bytes > 0, `${bytes} bytes in the first chunk`);
    await reader.cancel();
  }
  clearTimeout(timer);
} catch (cause) {
  bad("GET /video is an MJPEG stream", cause instanceof Error ? cause.message : String(cause));
}

// ---- hold ----------------------------------------------------------------------------------
const target = state ? Object.keys(state.spots).find((id) => state!.spots[id].status === "available") : undefined;

if (!target) {
  warn("no free stall to test a hold against", "the lot is full, rerun when something frees up");
} else {
  async function placeHold(session: string) {
    const response = await fetch(`${ORIGIN}/api/hold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spot_id: target, session_id: session }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  try {
    const first = await placeHold("preflight-a");
    if (typeof first.body.error === "string") {
      warn(`holding ${target} was refused`, String(first.body.error));
    } else {
      ok(`POST /api/hold takes a hold on ${target}`);
      check("the hold comes back with an expiry", typeof first.body.held_until === "string", JSON.stringify(first.body.held_until));
      check(
        "the expiry is a real time in the future",
        typeof first.body.held_until === "string" && Date.parse(first.body.held_until) > Date.now() - 5000,
        String(first.body.held_until),
      );

      const route = Array.isArray(first.body.route) ? (first.body.route as number[][]) : [];
      check("the hold comes back with a route", route.length >= 2, `${route.length} waypoints`);
      check(
        "route waypoints are normalised 0 to 1",
        route.every((p) => normalised(p?.[0]) && normalised(p?.[1])),
        route.length ? JSON.stringify(route[0]) : "",
      );

      // The whole point of the feature, and the answer to the most likely judge question.
      const second = await placeHold("preflight-b");
      check(
        "a second driver is refused the same stall",
        typeof second.body.error === "string",
        typeof second.body.error === "string" ? String(second.body.error) : "the second hold was granted, two drivers would be sent to one stall",
      );
      // A refusal on 200 is readable only by clients that parse the body. 409 is the status
      // that makes the refusal impossible to mistake for a grant.
      check(
        "the refusal uses a refusal status",
        second.status === 409,
        `answered ${second.status}, expected 409`,
      );
    }
  } catch (cause) {
    bad("POST /api/hold works", cause instanceof Error ? cause.message : String(cause));
  }
}

// ---- analytics -------------------------------------------------------------------------------
try {
  const analytics = await getJson<Analytics>("/api/analytics");
  ok("GET /api/analytics answers");

  // The pipeline reports the occupancy curve directly now. Prefer it: reconstructing from
  // transition counts is a fallback for a server that cannot, not the better answer.
  const levels = (analytics as unknown as { levels?: { t: string; occupied: number; total: number }[] }).levels ?? [];
  if (levels.length > 0) {
    ok("GET /api/analytics reports occupancy levels", `${levels.length} buckets`);
    check("levels carry a parseable time", Number.isFinite(Date.parse(levels[0].t)), String(levels[0].t));
    check(
      "levels are within capacity",
      levels.every((l) => Number.isFinite(l.occupied) && l.occupied >= 0 && (!l.total || l.occupied <= l.total)),
      JSON.stringify(levels[0]),
    );
  } else {
    warn(
      "no levels array in the analytics payload",
      "the frontend will reconstruct the curve from transition counts instead, which is fine but approximate at the edges",
    );
  }

  const buckets = analytics.buckets ?? [];
  if (buckets.length === 0) {
    warn("the history is empty", "replay a stretch of the day first, the aggregate needs events to bucket");
  } else {
    check("buckets carry a parseable time", Number.isFinite(Date.parse(buckets[0].t)), String(buckets[0].t));
    check(
      "buckets carry transition counts",
      buckets.every((b) => Number.isFinite(b.became_occupied) && Number.isFinite(b.became_available)),
      `${buckets.length} buckets`,
    );

    const series = reconstruct(buckets, state?.summary.occupied ?? 0, state?.summary.total ?? 0);
    check("the history reconstructs into a curve", series.points.length > 1, `${series.points.length} points`);
    if (series.incomplete) {
      warn(
        "the window does not explain the current occupancy",
        "the curve will be drawn but flagged approximate. Usually means the replay started mid day",
      );
    } else {
      ok("the curve is fully explained by the stored events");
    }
    if (series.bucketMinutes != null) ok("bucket width", `${series.bucketMinutes} min`);
  }
} catch (cause) {
  bad("GET /api/analytics answers", cause instanceof Error ? cause.message : String(cause));
}

// ---- verdict ----------------------------------------------------------------------------------
console.log("");
if (failures === 0 && warnings === 0) {
  console.log("preflight clean: the frontend can run against this pipeline with VITE_USE_MOCK=0\n");
} else if (failures === 0) {
  console.log(`preflight passed with ${warnings} warning(s): safe to run, read the warnings above\n`);
} else {
  console.log(`preflight found ${failures} problem(s)${warnings ? ` and ${warnings} warning(s)` : ""}\n`);
}
process.exit(failures === 0 ? 0 : 1);
