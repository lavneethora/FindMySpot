import type { Layout, ParkState } from "../lib/contract";
import { STATUS_ORDER, styleFor } from "../lib/status";
import { Panel, PanelHead } from "./ui/Panel";
import { Placeholder } from "./ui/Placeholder";

interface TwinPanelProps {
  layout: Layout | null;
  state: ParkState | null;
}

/**
 * The digital twin. `solid` for the same reason as the vision panel: the map animates on
 * every state change and must not sit under a backdrop filter.
 */
export function TwinPanel({ layout, state }: TwinPanelProps) {
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
            ? `${Object.keys(layout.spots).length} stalls, rectified to an overhead view by a four point homography.`
            : "Rectified to an overhead view by a four point homography."
        }
      />
      <Placeholder what="The top down map lands here in the next change." ratio="16 / 10" />

      {/* The legend is the second channel that makes the map readable without colour, so it
          ships with the shell rather than waiting for the map itself. */}
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
      </ul>
    </Panel>
  );
}
