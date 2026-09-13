import { useEffect, useState } from "react";
import type { Point } from "../lib/contract";

export interface DriverRoute {
  id: number;
  /** A simulated starting position, in the same normalized space as the map. */
  x: number;
  y: number;
  route: Point[];
}

interface Routes {
  /** The driver's own path, from where they are now. */
  entrance: Point[];
  /** The same driver simulated at other points in the lot. */
  drivers: DriverRoute[];
}

const EMPTY: Routes = { entrance: [], drivers: [] };

/**
 * Every way to reach one stall.
 *
 * Routing is done by the pipeline against the lane graph, not here, because a route that does
 * not follow the lanes is wrong in a way that is hard to see and easy to ship: a straight line
 * to a stall looks perfectly reasonable until you notice it crosses two rows of parked cars.
 *
 * Several starting positions are routed to the same stall on purpose. These are not other
 * drivers competing for it: it is one driver placed elsewhere, so the routing can be seen
 * adapting. One path could be a coincidence; three paths each bending a different way round
 * the rows shows the system is solving the lot rather than drawing a line.
 */
export function useRoutes(spotId: string | null, mock: boolean): Routes {
  const [routes, setRoutes] = useState<Routes>(EMPTY);

  useEffect(() => {
    if (!spotId || mock) {
      setRoutes(EMPTY);
      return;
    }

    let current = true;

    fetch(`/api/routes/${encodeURIComponent(spotId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!current || !body) return;
        setRoutes({
          entrance: Array.isArray(body.entrance) ? (body.entrance as Point[]) : [],
          drivers: Array.isArray(body.drivers) ? (body.drivers as DriverRoute[]) : [],
        });
      })
      .catch(() => {
        // A missing route is not worth breaking the map over. The stall is still
        // selectable and still shows as free.
        if (current) setRoutes(EMPTY);
      });

    return () => {
      current = false;
    };
  }, [spotId, mock]);

  return routes;
}
