import type { ParkState } from "../lib/contract";
import { Panel } from "./ui/Panel";
import { Stat } from "./ui/Stat";

interface SummaryStripProps {
  state: ParkState | null;
  /**
   * Detector accuracy is an operator's concern. A driver looking for a space does not need to
   * be told how confident the vision model is, and showing it invites doubt about a number
   * they cannot act on.
   */
  showAccuracy?: boolean;
}

/**
 * The numbers a driver and an operator both look at first. Everything here comes straight off
 * the state message. Nothing is recomputed in the browser, which is the same rule that keeps
 * geometry out of the frontend.
 */
export function SummaryStrip({ state, showAccuracy = false }: SummaryStripProps) {
  const summary = state?.summary;
  const accuracy = summary?.accuracy;

  return (
    <Panel
      className={`grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 ${showAccuracy ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
    >
      <Stat label="Available now" value={summary?.available ?? "--"} tone="var(--color-open)" />
      <Stat label="Occupied" value={summary?.occupied ?? "--"} tone="var(--color-taken)" />
      <Stat label="Stalls monitored" value={summary?.total ?? "--"} />
      {showAccuracy && (
        <Stat
          label="Per stall accuracy"
          value={accuracy != null ? `${(accuracy * 100).toFixed(1)}%` : "--"}
          note="against ground truth"
        />
      )}
      <Stat
        label="Closest open stall"
        value={state?.best_spot ?? "--"}
        note={state?.best_spot ? undefined : "none free"}
        tone="var(--color-open)"
      />
    </Panel>
  );
}
