import { memo } from "react";
import type { Layout, ParkState } from "../../lib/contract";
import { labelSize, path, SCALE, units } from "../../lib/geometry";
import { styleFor, type DisplayStatus } from "../../lib/status";

interface StallLayerProps {
  layout: Layout;
  state: ParkState | null;
  bestSpot: string | null;
  /**
   * Changes only when some stall's status changes. The car layer updates eight times a
   * second, and without this the twenty eight stalls would be reconciled and repainted at
   * that rate for no reason.
   */
  signature: string;
}

function StallLayerInner({ layout, state, bestSpot }: StallLayerProps) {
  return (
    <g>
      {Object.entries(layout.spots).map(([id, spot]) => {
        const status = (state?.spots[id]?.status ?? "unknown") as DisplayStatus;
        const style = styleFor(status);
        const [cx, cy] = units(spot.centroid);
        const size = labelSize(spot.polygon);
        const isBest = id === bestSpot;
        const points = path(spot.polygon);

        return (
          <g key={id} className="stall">
            <polygon
              points={points}
              fill={style.fill}
              stroke={style.edge}
              strokeWidth={isBest ? 6 : 3}
              strokeLinejoin="round"
              /* Colour moves over 400ms so a flip reads as a change rather than a glitch,
                 and the global reduced motion rule turns this off. */
              style={{ transition: "fill 400ms ease, stroke 400ms ease, stroke-width 200ms ease" }}
            >
              <title>{`${id}: ${style.label}`}</title>
            </polygon>

            {style.pattern && (
              <polygon
                points={points}
                fill={`url(#pattern-${style.pattern})`}
                stroke="none"
                pointerEvents="none"
              />
            )}

            {/* The recommendation gets a ring rather than a different fill, so it does not
                cost the status palette one of its four distinguishable values. */}
            {isBest && (
              <polygon
                points={points}
                fill="none"
                stroke={style.edge}
                strokeWidth={3}
                strokeDasharray="14 10"
                opacity={0.85}
                pointerEvents="none"
                transform={`translate(${cx} ${cy}) scale(1.16) translate(${-cx} ${-cy})`}
              />
            )}

            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={size}
              fontWeight={600}
              fill={style.on}
              pointerEvents="none"
              style={{ transition: "fill 400ms ease" }}
            >
              {id}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export const StallLayer = memo(
  StallLayerInner,
  (a, b) => a.signature === b.signature && a.bestSpot === b.bestSpot && a.layout === b.layout,
);

/** Cheap string that changes when, and only when, some stall changes status. */
export function statusSignature(state: ParkState | null): string {
  if (!state) return "";
  let out = "";
  for (const [id, spot] of Object.entries(state.spots)) out += `${id}${spot.status[0]}`;
  return out;
}

export const MAP_SCALE = SCALE;
