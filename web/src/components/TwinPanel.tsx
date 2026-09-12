import type { Layout, ParkState, Point } from "../lib/contract";
import { STATUS_ORDER, styleFor } from "../lib/status";
import { Panel, PanelHead } from "./ui/Panel";
import { Placeholder } from "./ui/Placeholder";
import { MAP_ASPECT, TopDownMap } from "./twin/TopDownMap";

interface TwinPanelProps {
  layout: Layout | null;
  state: ParkState | null;
  heldSpot?: string | null;
  route?: Point[];
  onSelect?: (spotId: string) => void;
}

/**
 * The digital twin. `solid` rather than `glass` because the map animates on every state
 * change and must not sit under a backdrop filter.
 */
export function TwinPanel({ layout, state, heldSpot = null, route, onSelect }: TwinPanelProps) {
  const counts = STATUS_ORDER.map((status) => ({
    status,
    style: styleFor(status),
    count: state ? Object.values(state.spots).filter((s) => s.status === status).length : 0,
  }));

  return (
    <Panel tone="solid" className="flex flex-col">
      <PanelHead
        title="Digital twin"
        hint={
          layout
            ? `${Object.keys(layout.spots).length} stalls, rectified to an overhead view by a four point homography. Click a free stall to hold it.`
            : "Rectified to an overhead view by a four point homography."
        }
      />

      <div
        className="overflow-hidden rounded-panel border border-card-border"
        style={{ aspectRatio: `${MAP_ASPECT}` }}
      >
        {layout ? (
          <TopDownMap layout={layout} state={state} heldSpot={heldSpot} route={route} onSelect={onSelect} />
        ) : (
          <Placeholder what="Waiting for the lot layout." ratio={`${MAP_ASPECT}`} />
        )}
      </div>

      {/* The legend is the second channel that makes the map readable without colour. */}
      <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {counts.map(({ status, style, count }) => (
          <li key={status} className="flex items-center gap-2 text-small">
            <span
              aria-hidden
              className="size-3 rounded-[3px]"
              style={{ backgroundColor: style.fill, outline: `1px solid ${style.edge}` }}
            />
            <span style={{ color: style.ink }}>{style.short}</span>
            <span className="tabular text-ink/40">{count}</span>
          </li>
        ))}
        <li className="ml-auto flex items-center gap-2 text-small text-ink/40">
          <span aria-hidden className="size-3 rounded-full border-2 border-dashed border-open-edge" />
          closest open stall
        </li>
      </ul>
    </Panel>
  );
}
