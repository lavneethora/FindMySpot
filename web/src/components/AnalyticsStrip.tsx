import { Panel, PanelHead } from "./ui/Panel";
import { Placeholder } from "./ui/Placeholder";

/**
 * Occupancy over time, peak and turnover, read from the Timescale continuous aggregate.
 *
 * Still a placeholder because there is no analytics contract yet. `contracts/README.md` lists
 * GET /api/analytics but there is no schema and no mock, and guessing the shape here would
 * mean rewriting it when the real one arrives.
 */
export function AnalyticsStrip() {
  return (
    <Panel className="flex flex-col">
      <PanelHead
        title="How this lot gets used"
        hint="Occupancy over time, peak and turnover, from stored state changes."
      />
      <Placeholder
        what="Waiting on the analytics contract. The endpoint is listed in contracts/README.md but has no schema or mock yet."
        ratio="21 / 7"
      />
    </Panel>
  );
}
