import { useEffect, useState } from "react";
import type { Point } from "../lib/contract";

export interface DriverRoute {
  id: number;
  /** Where the car is sitting now, in the same normalized space as the map. */
  x: number;
  y: number;
  route: Point[];
}

interface Routes {
  /** From the entrance. The path a new arrival follows. */
  entrance: Point[];
  /** From each car already circling the lot. */
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
 * Several cars are routed to the same stall on purpose. One path could be a coincidence; three
 * paths all bending around the same rows is the lane network made visible.
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
