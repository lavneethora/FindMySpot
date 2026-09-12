/**
 * The mock pipeline. Replays contracts/mock_sequence.json in process so the whole UI can be
 * built and polished with no Python, no PKLot download and no network.
 *
 * Everything in this file is mock only. It stands in for the vision lane, so logic that
 * belongs on the server (recomputing best_spot, synthesizing a route, expiring a hold) lives
 * here rather than leaking into components. When VITE_USE_MOCK is off, none of it runs.
 */

import rawLayout from "@contracts/mock_layout.json";
import rawSequence from "@contracts/mock_sequence.json";
import type { Car, Hold, Layout, ParkState, Point, Transition } from "./contract";

const layout = rawLayout as unknown as Layout;
const sequence = rawSequence as unknown as ParkState[];

/** One captured frame every 2 s, so a ten frame fixture loops in twenty seconds. */
export const FRAME_MS = 2000;
/** 8 Hz emission. Enough for smooth car motion without flooding React. */
export const TICK_MS = 125;
/** Matches the 90 second soft hold in the PRD. */
export const HOLD_MS = 90_000;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Cars are matched by track id. A car missing from the next frame simply stops moving. */
function tweenCars(from: Car[], to: Car[], t: number): Car[] {
  return from.map((car) => {
    const next = to.find((c) => c.id === car.id);
    if (!next) return car;
    return { id: car.id, x: lerp(car.x, next.x, t), y: lerp(car.y, next.y, t) };
  });
}

/**
 * The fixture declares last_event on the frame where it fires, but it cannot describe the
 * wrap from the last frame back to the first. Diffing covers that, and on the frames the
 * fixture does describe it reproduces exactly what the fixture says.
 */
function diffFrames(prev: ParkState, next: ParkState): Transition | null {
  if (next.last_event) return next.last_event;
  for (const [id, spot] of Object.entries(next.spots)) {
    const before = prev.spots[id];
    if (before && before.status !== spot.status) {
      return { spot_id: id, from: before.status, to: spot.status };
    }
  }
  return null;
}

/**
 * Entrance, up the centre lane to the cross aisle, along the aisle, then into the stall.
 * The aisle graph in mock_layout.json has duplicate node coordinates so it cannot be walked,
 * which is fine: the real route comes from the server. This only has to look right.
 */
function routeTo(spotId: string): Point[] {
  const entrance = layout.entrance;
  const target = layout.spots[spotId]?.centroid;
  if (!target) return [];

  const aisleY = layout.aisles?.nodes?.main?.[1] ?? 0.48;
  const lane: Point = [entrance.x, aisleY];
  const turn: Point = [target[0], aisleY];

  const points: Point[] = [[entrance.x, entrance.y], lane, turn, [target[0], target[1]]];
  // Drop a waypoint that lands on top of the one before it, so the dash animation does not
  // stall on a zero length segment.
  return points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-4);
}

export class MockPipeline {
  private holds = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private lastFrame = -1;
  private emitted = false;
  /** The most recently composed state. hold() reads this instead of composing again,
      because compose() advances the frame tracking and would swallow a last_event. */
  private current: ParkState | null = null;

  getLayout(): Promise<Layout> {
    return Promise.resolve(layout);
  }

  hold(spotId: string): Promise<Hold> {
    const status = this.current?.spots[spotId]?.status;
    if (status !== "available") {
      return Promise.reject(new Error(`${spotId} is ${status ?? "unknown"}, not available`));
    }
    const until = Date.now() + HOLD_MS;
    this.holds.set(spotId, until);
    return Promise.resolve({
      spot_id: spotId,
      held_until: new Date(until).toISOString(),
      route: routeTo(spotId),
    });
  }

  start(onState: (state: ParkState) => void): void {
    this.stop();
    this.startedAt = Date.now();
    this.lastFrame = -1;
    this.emitted = false;
    this.current = null;
    const emit = () => onState(this.compose(this.now()));
    emit();
    this.timer = setInterval(emit, TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private now(): number {
    return Date.now() - this.startedAt;
  }

  /** Build the state for a point in the replay, holds applied on top of the fixture. */
  private compose(elapsed: number): ParkState {
    const position = elapsed / FRAME_MS;
    const index = Math.floor(position) % sequence.length;
    const t = position - Math.floor(position);

    const frame = sequence[index];
    const next = sequence[(index + 1) % sequence.length];
    const prev = sequence[(index - 1 + sequence.length) % sequence.length];

    const spots: ParkState["spots"] = {};
    let occupied = 0;
    let held = 0;

    for (const [id, spot] of Object.entries(frame.spots)) {
      const expiry = this.holds.get(id);
      // A hold dies on expiry, and also the moment the camera sees a car arrive. That second
      // rule is the one the PRD cares about and it is worth having in the mock too.
      if (expiry !== undefined && (expiry <= Date.now() || spot.status === "occupied")) {
        this.holds.delete(id);
      }
      const live = this.holds.get(id);
      if (live !== undefined && spot.status === "available") {
        spots[id] = { status: "held", confidence: null, vehicle_id: null, held_until: new Date(live).toISOString() };
        held += 1;
      } else {
        spots[id] = spot;
        if (spot.status === "occupied") occupied += 1;
      }
    }

    const total = Object.keys(spots).length;
    const available = total - occupied - held;

    // last_event fires once, on the tick where the frame index changes, not on every tick.
    // Never on the very first emission: arriving at frame 0 is not a transition, and an
    // activity feed that announces a stall change the instant the page loads is a lie.
    const crossed = this.emitted && index !== this.lastFrame;
    this.lastFrame = index;
    this.emitted = true;

    const composed: ParkState = {
      camera_id: frame.camera_id,
      timestamp: frame.timestamp,
      spots,
      cars: tweenCars(frame.cars, next.cars, t),
      summary: { total, occupied, available, accuracy: frame.summary.accuracy ?? null },
      best_spot: this.bestSpot(spots),
      last_event: crossed ? diffFrames(prev, frame) : null,
    };
    this.current = composed;
    return composed;
  }

  /**
   * The fixture pins best_spot to B9 even after A7 frees, and it cannot know about holds.
   * The server owns this in production; the mock has to own it here or the recommendation
   * visibly ignores the stall that just opened.
   */
  private bestSpot(spots: ParkState["spots"]): string | null {
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const [id, spot] of Object.entries(spots)) {
      if (spot.status !== "available") continue;
      const distance = layout.spots[id]?.distance_to_entrance_m ?? Infinity;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    }
    return best;
  }
}
