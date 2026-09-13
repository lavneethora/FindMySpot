/**
 * The occupancy curve.
 *
 * The pipeline now records the level once per frame and serves it as `levels`, so the curve is
 * read directly. `fromLevels` is the path that runs.
 *
 * `reconstruct` is kept for the mock and for any pipeline old enough not to send levels. It
 * walks the transition buckets BACKWARDS from the known present, because summing them forwards
 * would need a starting occupancy nobody stores. That made the far end of the curve
 * approximate, which is exactly why reading the real level is better.
 */

import type { AnalyticsBucket, AnalyticsLevel } from "./contract";

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

/**
 * Read the curve the pipeline recorded. No inference, no approximation.
 *
 * Arrivals and departures still come from the transition buckets, matched by bucket start, so
 * the bars under the curve remain the stored counts rather than anything derived.
 */
export function fromLevels(
  levels: AnalyticsLevel[],
  buckets: AnalyticsBucket[],
  total: number,
): OccupancySeries {
  const byTime = new Map<number, AnalyticsBucket>();
  for (const b of buckets) {
    const t = new Date(b.t).getTime();
    if (Number.isFinite(t)) byTime.set(t, b);
  }

  const points: OccupancyPoint[] = levels
    .map((l) => {
      const time = new Date(l.t).getTime();
      const bucket = byTime.get(time);
      return {
        t: l.t,
        time,
        occupied: Math.round(Number(l.occupied) || 0),
        arrivals: Number(bucket?.became_occupied) || 0,
        departures: Number(bucket?.became_available) || 0,
      };
    })
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);

  if (points.length === 0) return { ...EMPTY, total: Math.max(0, total) };

  const lotTotal = Number(levels[0]?.total) || total;
  const bucketMinutes = inferBucketMinutes(points);
  const spanMs = points[points.length - 1].time - points[0].time;
  const spanHours = (spanMs + (bucketMinutes ?? 5) * 60_000) / 3_600_000;

  let peak = points[0];
  let busiest = points[0];
  let events = 0;
  for (const p of points) {
    if (p.occupied > peak.occupied) peak = p;
    if (p.arrivals + p.departures > busiest.arrivals + busiest.departures) busiest = p;
    events += p.arrivals + p.departures;
  }

  return {
    points,
    total: lotTotal,
    peak,
    busiest,
    events,
    bucketMinutes,
    spanHours,
    turnoverPerStallPerHour:
      lotTotal > 0 && spanHours > 0 ? events / lotTotal / spanHours : 0,
    // Measured, not inferred, so there is no incomplete window to warn about.
    incomplete: false,
  };
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
