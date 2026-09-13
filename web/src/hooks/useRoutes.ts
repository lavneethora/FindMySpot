import { useEffect, useState } from "react";
import type { Point } from "../lib/contract";

interface Routes {
  /** From the entrance. The one a new arrival follows. */
  primary: Point[];
  /** From drivers already inside the lot, drawn faintly behind it. */
  others: Point[][];
}

const EMPTY: Routes = { primary: [], others: [] };

/**
 * Every way to reach one stall.
 *
 * Routing is done by the pipeline against the lane graph, not here, because a route that does
 * not follow the lanes is wrong in a way that is hard to see and easy to ship: a straight line
 * to a stall looks perfectly reasonable until you notice it crosses two rows of parked cars.
 *
 * Several drivers are routed to the same stall on purpose. One path could be a coincidence;
 * three paths all bending around the same rows is the lane network made visible.
 */
export function useRoutes(spotId: string | null, mock: boolean): Routes {
  const [routes, setRoutes] = useState<Routes>(EMPTY);

  useEffect(() => {
    if (!spotId || mock) {
      setRoutes(EMPTY);
      return;
    }

    let current = true;

    async function load() {
      try {
        const lanes = await fetch("/api/lanes").then((r) => r.json());
        const starts: string[] = Array.isArray(lanes?.driver_starts)
          ? lanes.driver_starts
          : ["entrance"];

        const fetched = await Promise.all(
          starts.map((from) =>
            fetch(`/api/route/${encodeURIComponent(spotId!)}?from_node=${encodeURIComponent(from)}`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null),
          ),
        );
        if (!current) return;

        const paths = fetched.map((f) => (Array.isArray(f?.route) ? (f.route as Point[]) : []));
        setRoutes({ primary: paths[0] ?? [], others: paths.slice(1).filter((p) => p.length > 1) });
      } catch {
        // A missing route is not worth breaking the map over. The stall is still
        // selectable and still shows as free.
        if (current) setRoutes(EMPTY);
      }
    }

    void load();
    return () => {
      current = false;
    };
  }, [spotId, mock]);

  return routes;
}
