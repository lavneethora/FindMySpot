/**
 * Turning stored state changes into an occupancy curve.
 *
 * `parking_events` records transitions, never levels, so the continuous aggregate can say how
 * many stalls filled and emptied in each bucket but not how full the lot was. Those are
 * different quantities: one is the derivative of the other.
 *
 * The lot's occupancy right now is known exactly, from the live state message. So the curve is
 * recovered by walking the buckets BACKWARDS from that known endpoint, subtracting each
 * bucket's net change as we go. Forwards would need a starting occupancy nobody stores.
 *
 * This is arithmetic on data the pipeline already sends, not a second source of truth. If the
 * vision lane later returns the level directly, delete this and read it.
 */

import type { AnalyticsBucket } from "./contract";

export interface OccupancyPoint {
  t: string;
  time: number;
  /** Reconstructed number of occupied stalls at the END of this bucket. */
  occupied: number;
  arrivals: number;
  departures: number;
}

export interface OccupancySeries {
  points: OccupancyPoint[];
  total: number;
  peak: OccupancyPoint | null;
  /** Bucket with the most comings and goings, which is not always the fullest one. */
  busiest: OccupancyPoint | null;
  events: number;
  turnoverPerStallPerHour: number;
  bucketMinutes: number | null;
  spanHours: number;
  /**
   * True when the reconstruction ran below zero or above capacity, which means the window does
   * not contain every event needed to explain the current count. Shown to the viewer rather
   * than hidden, because a silently wrong history is worse than an honest gap.
   */
  incomplete: boolean;
}

const EMPTY: OccupancySeries = {
  points: [],
  total: 0,
  peak: null,
  busiest: null,
  events: 0,
  turnoverPerStallPerHour: 0,
  bucketMinutes: null,
  spanHours: 0,
  incomplete: false,
};

/** Median gap between buckets, so an occasional missing bucket does not skew the estimate. */
function inferBucketMinutes(points: { time: number }[]): number | null {
  if (points.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i += 1) gaps.push(points[i].time - points[i - 1].time);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return median > 0 ? Math.round(median / 60_000) : null;
}

export function reconstruct(
  buckets: AnalyticsBucket[],
  currentOccupied: number,
  total: number,
): OccupancySeries {
  if (!buckets || buckets.length === 0 || total <= 0) return { ...EMPTY, total: Math.max(0, total) };

  const ordered = buckets
    .map((b) => ({
      t: b.t,
      time: new Date(b.t).getTime(),
      arrivals: Number(b.became_occupied) || 0,
      departures: Number(b.became_available) || 0,
    }))
    .filter((b) => Number.isFinite(b.time))
    .sort((a, b) => a.time - b.time);

  if (ordered.length === 0) return { ...EMPTY, total };

  // Walk backwards from the known present.
  const levels = new Array<number>(ordered.length);
  let running = currentOccupied;
  let incomplete = false;

  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    if (running < 0 || running > total) incomplete = true;
    levels[i] = Math.max(0, Math.min(total, running));
    running -= ordered[i].arrivals - ordered[i].departures;
  }

  const points: OccupancyPoint[] = ordered.map((b, i) => ({
    t: b.t,
    time: b.time,
    occupied: levels[i],
    arrivals: b.arrivals,
    departures: b.departures,
  }));

  let peak = points[0];
  let busiest = points[0];
  let events = 0;
  for (const p of points) {
    if (p.occupied > peak.occupied) peak = p;
    if (p.arrivals + p.departures > busiest.arrivals + busiest.departures) busiest = p;
    events += p.arrivals + p.departures;
  }

  const spanMs = points[points.length - 1].time - points[0].time;
  const bucketMinutes = inferBucketMinutes(points);
  // One bucket wide is still a window: count the last bucket's own duration.
  const spanHours = (spanMs + (bucketMinutes ?? 5) * 60_000) / 3_600_000;

  return {
    points,
    total,
    peak,
    busiest: busiest.arrivals + busiest.departures > 0 ? busiest : null,
    events,
    turnoverPerStallPerHour: spanHours > 0 ? events / total / spanHours : 0,
    bucketMinutes,
    spanHours,
    incomplete,
  };
}
