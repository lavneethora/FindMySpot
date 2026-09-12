import { useEffect, useState } from "react";
import type { Analytics, ParkState } from "../lib/contract";
import { reconstruct, type OccupancySeries } from "../lib/analytics";

/** History changes slowly. Polling harder only makes the aggregate refresh more often. */
const REFRESH_MS = 30_000;

export interface AnalyticsState {
  series: OccupancySeries | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the stored history and turns it into a curve.
 *
 * Takes the fetcher rather than building its own source. Creating a second source here would
 * open a second WebSocket in live mode and run a second replay in mock mode, and the two
 * copies would disagree with each other on screen.
 *
 * The reconstruction is anchored on the lot's present occupancy, so it is recomputed from the
 * latest state message rather than cached alongside the fetch. That keeps the right hand end
 * of the curve pinned to the number displayed above it, instead of drifting between polls.
 */
export function useAnalytics(
  fetchAnalytics: () => Promise<Analytics>,
  state: ParkState | null,
): AnalyticsState {
  const [raw, setRaw] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    const load = () => {
      fetchAnalytics()
        .then((next) => {
          if (!live) return;
          setRaw(next);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (!live) return;
          setError(cause instanceof Error ? cause.message : "Could not load the lot history");
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [fetchAnalytics]);

  const series = raw
    ? reconstruct(raw.buckets, state?.summary.occupied ?? 0, state?.summary.total ?? 0)
    : null;

  return { series, loading, error };
}
