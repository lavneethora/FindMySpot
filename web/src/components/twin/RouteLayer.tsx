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
 * The routes to a chosen stall: the driver's own, plus one per car already in the lot.
 *
 * Routes are computed by the pipeline against the lane graph, so every segment is a real
 * lane. Declaring pathLength as 1 lets the dash animation work in fractions of the route, so
 * the same keyframes look right whether the stall is the nearest one or the furthest.
 *
 * Every route draws itself, staggered. A path that simply appears reads as a diagram; one
 * that draws itself reads as a car setting off, which is the point of showing several at once.
 */
/** One colour per car, so three paths down the same lane stay tellable apart. */
const DRIVER_COLOURS = ["#2f6f8e", "#8a5cc4", "#b8722a"];

export function RouteLayer({ route, drivers = [] }: RouteLayerProps) {
  if (route.length < 2) return null;

  const points = path(route);
  const [endX, endY] = units(route[route.length - 1]);
  const [startX, startY] = units(route[0]);
  // Remounts the group when the destination changes, which restarts the draw animation.
  const key = points;

  return (
    <g key={key} pointerEvents="none">
      {drivers.map((driver, index) => {
        const [cx, cy] = units([driver.x, driver.y]);
        const colour = DRIVER_COLOURS[index % DRIVER_COLOURS.length];
        // Cars share lanes, so their routes lie on top of each other and three
        // paths read as one. Nudging each a little to one side draws them as
        // parallel lines down the same lane, which is what a driver sees
        // anyway: several cars in the aisle, not one.
        const nudge = (index - (drivers.length - 1) / 2) * 9;
        return (
          <g key={`driver-${driver.id}`} transform={`translate(${nudge} ${nudge})`}>
            {driver.route.length >= 2 && (
              <>
                {/* Drawn in, same as the main route. A path that simply appears
                    reads as a diagram; one that draws itself reads as a car
                    setting off, which is the whole point of showing several. */}
                <polyline
                  points={path(driver.route)}
                  fill="none"
                  stroke={colour}
                  strokeOpacity={0.85}
                  strokeWidth={5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray={1}
                  style={{
                    animation: "route-draw 700ms ease-out forwards",
                    // Staggered so three cars set off in turn rather than
                    // together, which is easier to follow and looks less like
                    // one path splitting.
                    animationDelay: `${index * 220}ms`,
                  }}
                />
                {/* The moving dashes, once the path has drawn. */}
                <polyline
                  points={path(driver.route)}
                  fill="none"
                  stroke="rgb(255 253 250 / 0.75)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray="0.022 0.046"
                  style={{
                    animation: "route-flow 1.1s linear infinite",
                    animationDelay: `${700 + index * 220}ms`,
                  }}
                />
              </>
            )}
            {/* The car itself. Drawn as a rounded body rather than a dot so it reads as a
                vehicle waiting in the aisle, not as another occupied stall. */}
            <g transform={`translate(${cx} ${cy})`}>
              <rect
                x={-13}
                y={-19}
                width={26}
                height={38}
                rx={7}
                fill={colour}
                stroke="rgb(255 253 250 / 0.95)"
                strokeWidth={3}
              />
              <text
                y={6}
                textAnchor="middle"
                fontSize={17}
                fontWeight={700}
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
