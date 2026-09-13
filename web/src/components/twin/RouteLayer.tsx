import type { Point } from "../../lib/contract";
import { path, units } from "../../lib/geometry";

interface RouteLayerProps {
  route: Point[];
}

/**
 * The animated path from the entrance to the held stall.
 *
 * The route is computed by the server and arrives with the hold. Declaring pathLength as 1
 * lets the dash animation work in fractions of the route, so the same keyframes look right
 * whether the stall is the nearest one or the furthest.
 */
export function RouteLayer({ route }: RouteLayerProps) {
  if (route.length < 2) return null;

  const points = path(route);
  const [endX, endY] = units(route[route.length - 1]);
  const [startX, startY] = units(route[0]);
  // Remounts the group when the destination changes, which restarts the draw animation.
  const key = points;

  return (
    <g key={key} pointerEvents="none">
      {/* A light underlay so the route stays legible crossing both the dark occupied stalls
          and the pale asphalt. */}
      <polyline
        points={points}
        fill="none"
        stroke="rgb(255 253 250 / 0.9)"
        strokeWidth={30}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <polyline
        points={points}
        fill="none"
        stroke="var(--color-held-edge)"
        strokeWidth={13}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        style={{ animation: "route-draw 700ms ease-out forwards" }}
      />

      <polyline
        points={points}
        fill="none"
        stroke="rgb(255 253 250 / 0.85)"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="0.028 0.052"
        style={{ animation: "route-flow 1.1s linear infinite", animationDelay: "700ms" }}
      />

      <circle cx={startX} cy={startY} r={11} fill="var(--color-held-edge)" />
      <circle cx={endX} cy={endY} r={17} fill="var(--color-held-edge)" stroke="rgb(255 253 250 / 0.95)" strokeWidth={5} />
    </g>
  );
}
