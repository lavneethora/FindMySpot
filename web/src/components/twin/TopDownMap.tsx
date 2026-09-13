import { useEffect, useMemo, useRef, useState } from "react";
import type { Layout, ParkState } from "../../lib/contract";
import { SCALE, units, viewBoxFor, viewBoxString } from "../../lib/geometry";
import type { Point } from "../../lib/contract";
import { MapDefs } from "./MapDefs";
import { RouteLayer } from "./RouteLayer";
import { CarLayer } from "./CarLayer";
import { StallLayer, statusSignature } from "./StallLayer";

/**
 * Shape assumed before the element has been measured, and on a server render where there is
 * nothing to measure. The real value is read from the box the map is drawn into.
 */
export const MAP_ASPECT = 4 / 3;

interface TopDownMapProps {
  layout: Layout;
  state: ParkState | null;
  heldSpot?: string | null;
  route?: Point[];
  onSelect?: (spotId: string) => void;
}

export function TopDownMap({ layout, state, heldSpot = null, route, onSelect }: TopDownMapProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [aspect, setAspect] = useState(MAP_ASPECT);

  /**
   * Measure the box rather than assume it. The panel changes shape with the viewport, and a
   * viewBox computed for the wrong aspect means the lot is letterboxed inside its own panel
   * with dead bands down the sides. Reading the real size keeps the asphalt edge to edge at
   * any window shape.
   */
  useEffect(() => {
    const element = svg.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (!size || size.width <= 0 || size.height <= 0) return;
      const next = size.width / size.height;
      // Ignore sub pixel churn, or every scroll bar appearing retriggers a viewBox change.
      setAspect((current) => (Math.abs(current - next) < 0.005 ? current : next));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const box = useMemo(() => viewBoxFor(layout, aspect), [layout, aspect]);
  const signature = statusSignature(state);
  const [entranceX, entranceY] = units([layout.entrance.x, layout.entrance.y]);

  const aisles = layout.aisles;

  return (
    <svg
      ref={svg}
      viewBox={viewBoxString(box)}
      className="h-full w-full"
      role="img"
      aria-label={
        state
          ? `Top down map of ${Object.keys(layout.spots).length} stalls. ${state.summary.available} available, ${state.summary.occupied} occupied.`
          : "Top down map of the lot, waiting for data"
      }
    >
      <MapDefs />

      <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="url(#apron)" />

      {/* Aisle centre lines, drawn faintly so the lot reads as a lot rather than as floating
          rectangles. The graph in the layout has duplicate node coordinates, so degenerate
          edges are skipped instead of drawn as dots. */}
      {aisles?.nodes && aisles.edges && (
        <g stroke="#FFFDFA" strokeWidth={10} strokeLinecap="round" opacity={0.75}>
          {aisles.edges.map(([from, to], index) => {
            const a = aisles.nodes?.[from];
            const b = aisles.nodes?.[to];
            if (!a || !b) return null;
            const [ax, ay] = units(a);
            const [bx, by] = units(b);
            if (Math.hypot(ax - bx, ay - by) < 1) return null;
            return <line key={`${from}-${to}-${index}`} x1={ax} y1={ay} x2={bx} y2={by} />;
          })}
        </g>
      )}

      <StallLayer
        layout={layout}
        state={state}
        bestSpot={state?.best_spot ?? null}
        heldSpot={heldSpot}
        onSelect={onSelect}
        signature={signature}
      />

      {/* Above the stalls so it is never hidden by one, below the cars so a vehicle driving
          the route still reads as being on top of it. */}
      {route && route.length > 1 && <RouteLayer route={route} />}

      <CarLayer cars={state?.cars ?? []} />

      {/* Entrance. Routes start here, so it needs to be visible before any route exists. */}
      <g>
        <circle cx={entranceX} cy={entranceY} r={22} fill="#FFFDFA" stroke="#2B2825" strokeWidth={5} />
        <path
          d={`M ${entranceX} ${entranceY + 8} L ${entranceX} ${entranceY - 9} M ${entranceX - 7} ${entranceY - 2} L ${entranceX} ${entranceY - 9} L ${entranceX + 7} ${entranceY - 2}`}
          stroke="#2B2825"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <text
          x={entranceX}
          y={entranceY + 52}
          textAnchor="middle"
          fontSize={30}
          fontWeight={600}
          fill="#6E6963"
        >
          Entrance
        </text>
        <title>Lot entrance</title>
      </g>
    </svg>
  );
}

export const MAP_UNIT_SCALE = SCALE;
