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

import type { Hold, Layout, ParkState } from "./contract";
import { MockPipeline } from "./mock";

export type Connection = "connecting" | "live" | "mock" | "fallback";

export interface Source {
  getLayout(): Promise<Layout>;
  hold(spotId: string): Promise<Hold>;
  start(onState: (state: ParkState) => void, onConnection: (c: Connection) => void): void;
  stop(): void;
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

  async hold(spotId: string): Promise<Hold> {
    if (this.fallback) return this.fallback.hold(spotId);
    const response = await fetch("/api/hold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spot_id: spotId }),
    });
    if (!response.ok) throw new Error(`POST /api/hold returned ${response.status}`);
    return (await response.json()) as Hold;
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
