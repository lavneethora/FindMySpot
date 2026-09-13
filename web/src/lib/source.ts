/**
 * One interface over two transports. Components never know which one they are on.
 *
 * Mock is the default. Set VITE_USE_MOCK=0 to talk to the Python pipeline, which the Vite
 * dev server proxies on /api, /video and /ws so we stay same origin.
 *
 * The live transport falls back to the mock after a few failed attempts. That is demo
 * insurance: if the pipeline dies on stage, the UI keeps telling a coherent story instead of
 * showing an empty lot.
 */

import type { Analytics, Hold, Layout, ParkState, Point } from "./contract";
import { MockPipeline } from "./mock";

export type Connection = "connecting" | "live" | "mock" | "fallback";

export interface Source {
  getLayout(): Promise<Layout>;
  getAnalytics(): Promise<Analytics>;
  hold(spotId: string): Promise<Hold>;
  start(onState: (state: ParkState) => void, onConnection: (c: Connection) => void): void;
  stop(): void;
}

const FALLBACK_SESSION = `s-${Math.random().toString(36).slice(2, 10)}`;

/**
 * One id per browser tab.
 *
 * sessionStorage rather than localStorage, deliberately: two tabs have to count as two
 * drivers, which is precisely the "what if two people click the same stall" question the soft
 * hold exists to answer. Share the id across tabs and the second tab is allowed to take a
 * stall the first one is holding, and the demo proves nothing.
 */
export function sessionId(): string {
  try {
    const existing = sessionStorage.getItem("parktech.session");
    if (existing) return existing;
    sessionStorage.setItem("parktech.session", FALLBACK_SESSION);
    return FALLBACK_SESSION;
  } catch {
    // Private windows and blocked site data both throw. An in memory id still makes this tab
    // distinct for as long as it is open, which is all the demo needs.
    return FALLBACK_SESSION;
  }
}

/**
 * Turn whatever POST /api/hold returned into a Hold, or throw.
 *
 * The pipeline answers a refused hold with HTTP 200 and a body of {"error": "already held"},
 * not a 4xx. Checking response.ok alone therefore reports success, hands back an object with
 * no held_until, and leaves a hold that never counts down and never expires. Parse the body,
 * do not trust the status line.
 */
export function asHold(payload: unknown, spotId: string): Hold {
  if (!payload || typeof payload !== "object") {
    throw new Error(`The pipeline sent no answer for ${spotId}`);
  }
  const body = payload as Record<string, unknown>;

  if (typeof body.error === "string") {
    throw new Error(
      body.error === "already held" ? `${spotId} was just taken by someone else` : body.error,
    );
  }
  if (typeof body.held_until !== "string") {
    throw new Error(`The pipeline did not say how long ${spotId} is held for`);
  }

  return {
    spot_id: String(body.spot_id ?? spotId),
    held_until: body.held_until,
    route: Array.isArray(body.route) ? (body.route as Point[]) : [],
  };
}

export function useMock(): boolean {
  const flag = import.meta.env.VITE_USE_MOCK;
  return flag !== "0" && flag !== "false";
}

class MockSource implements Source {
  private pipeline = new MockPipeline();

  getLayout(): Promise<Layout> {
    return this.pipeline.getLayout();
  }

  getAnalytics(): Promise<Analytics> {
    return this.pipeline.getAnalytics();
  }

  hold(spotId: string): Promise<Hold> {
    return this.pipeline.hold(spotId);
  }

  start(onState: (state: ParkState) => void, onConnection: (c: Connection) => void): void {
    onConnection("mock");
    this.pipeline.start(onState);
  }

  stop(): void {
    this.pipeline.stop();
  }
}

/** Give up on the pipeline after this many failed connects and switch to the mock. */
const MAX_ATTEMPTS = 4;
const RETRY_MS = [500, 1000, 2000, 4000];

class LiveSource implements Source {
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private stopped = false;
  private fallback: MockSource | null = null;
  private onState: ((state: ParkState) => void) | null = null;
  private onConnection: ((c: Connection) => void) | null = null;

  async getLayout(): Promise<Layout> {
    if (this.fallback) return this.fallback.getLayout();
    const response = await fetch("/api/layout");
    if (!response.ok) throw new Error(`GET /api/layout returned ${response.status}`);
    return (await response.json()) as Layout;
  }

  async getAnalytics(): Promise<Analytics> {
    if (this.fallback) return this.fallback.getAnalytics();
    const response = await fetch("/api/analytics");
    if (!response.ok) throw new Error(`GET /api/analytics returned ${response.status}`);
    return (await response.json()) as Analytics;
  }

  async hold(spotId: string): Promise<Hold> {
    if (this.fallback) return this.fallback.hold(spotId);
    const response = await fetch("/api/hold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spot_id: spotId, session_id: sessionId() }),
    });
    // Parse the body even on a refusal. The pipeline answers a conflict with 409 and an
    // explanatory body, and "returned 409" on screen is strictly worse than what it says.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`POST /api/hold returned ${response.status}`);
    }
    return asHold(payload, spotId);
  }

  start(onState: (state: ParkState) => void, onConnection: (c: Connection) => void): void {
    this.stopped = false;
    this.onState = onState;
    this.onConnection = onConnection;
    onConnection("connecting");
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    this.fallback?.stop();
    this.fallback = null;
    if (this.socket) {
      // Drop the handler first, or close() re-enters scheduleRetry on the way out.
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.onConnection?.("live");
    };

    socket.onmessage = (event) => {
      try {
        this.onState?.(JSON.parse(event.data as string) as ParkState);
      } catch {
        // A malformed frame is not worth tearing the connection down for. Skip it.
      }
    };

    socket.onclose = () => {
      this.socket = null;
      this.scheduleRetry();
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped || this.fallback) return;
    if (this.attempts >= MAX_ATTEMPTS) {
      this.useFallback();
      return;
    }
    const delay = RETRY_MS[Math.min(this.attempts, RETRY_MS.length - 1)];
    this.attempts += 1;
    this.onConnection?.("connecting");
    this.retry = setTimeout(() => this.connect(), delay);
  }

  private useFallback(): void {
    this.fallback = new MockSource();
    this.fallback.start(
      (state) => this.onState?.(state),
      // Report "fallback" rather than "mock", so the UI can say the pipeline dropped instead
      // of pretending this was the plan.
      () => this.onConnection?.("fallback"),
    );
  }
}

export function createSource(): Source {
  return useMock() ? new MockSource() : new LiveSource();
}
