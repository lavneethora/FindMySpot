import type { Point } from "../../lib/contract";
import type { DriverRoute } from "../../hooks/useRoutes";
import { path, units } from "../../lib/geometry";

interface RouteLayerProps {
  route: Point[];
  /**
   * Cars already circling the lot, each with its own path to the same stall, drawn behind
   * the main one. Several cars converging on one space is what makes the lane network
   * legible: every path bends around the rows, because no car can drive through one.
   */
  drivers?: DriverRoute[];
}

/**
 * The animated path from the entrance to the held stall.
 *
 * The route is computed by the server and arrives with the hold. Declaring pathLength as 1
 * lets the dash animation work in fractions of the route, so the same keyframes look right
 * whether the stall is the nearest one or the furthest.
 */
export function RouteLayer({ route, drivers = [] }: RouteLayerProps) {
  if (route.length < 2) return null;

  const points = path(route);
  const [endX, endY] = units(route[route.length - 1]);
  const [startX, startY] = units(route[0]);
  // Remounts the group when the destination changes, which restarts the draw animation.
  const key = points;

  return (
    <g key={key} pointerEvents="none">
      {drivers.map((driver) => {
        const [cx, cy] = units([driver.x, driver.y]);
        return (
          <g key={`driver-${driver.id}`}>
            {driver.route.length >= 2 && (
              <polyline
                points={path(driver.route)}
                fill="none"
                stroke="var(--color-taken)"
                strokeOpacity={0.5}
                strokeWidth={7}
                strokeDasharray="14 12"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {/* The car itself. Drawn as a rounded body rather than a dot so it reads as a
                vehicle waiting in the aisle, not as another occupied stall. */}
            <g transform={`translate(${cx} ${cy})`}>
              <rect
                x={-9}
                y={-14}
                width={18}
                height={28}
                rx={5}
                fill="var(--color-taken)"
                fillOpacity={0.85}
                stroke="rgb(255 253 250 / 0.9)"
                strokeWidth={2.5}
              />
              <text
                y={5}
                textAnchor="middle"
                fontSize={13}
                fontWeight={600}
                fill="rgb(255 253 250)"
              >
                {driver.id}
              </text>
            </g>
          </g>
        );
      })}
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
