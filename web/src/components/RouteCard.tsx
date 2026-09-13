import type { Layout, ParkState } from "../lib/contract";
import { Panel, PanelHead } from "./ui/Panel";
import { statusOf } from "../lib/contract";

interface RouteCardProps {
  layout: Layout | null;
  state: ParkState | null;
  selected: string | null;
}

/**
 * Which stall to head for, and how far it is.
 *
 * This replaced a hold, which let a driver claim a stall for ninety seconds. The claim was
 * fiction: nothing physically stops another car taking the space, so telling a driver it is
 * theirs is a promise the product cannot keep. Showing the way to a free stall is a promise it
 * can keep, so that is what it does.
 */
export function RouteCard({ layout, state, selected }: RouteCardProps) {
  const best = state?.best_spot ?? null;
  const target = selected ?? best;
  const spot = target ? layout?.spots?.[target] : undefined;
  const status = statusOf(state, target ?? "");
  const stale = Boolean(selected) && status === "occupied";

  if (!target || !spot) {
    return (
      <Panel>
        <PanelHead title="Nothing free right now" hint="The map updates as stalls open." />
        <p className="text-small text-ink/45">
          Every monitored stall is taken. The moment one frees up it turns green here.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHead
        title={selected ? "Head for this one" : "Closest free stall"}
        hint={
          selected
            ? "Tap any other free stall to route there instead."
            : "Nearest to the entrance. Tap any stall to route there instead."
        }
      />
      <div className="flex items-center gap-3">
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-chip border text-h3 ${
            stale
              ? "border-danger/40 bg-danger/10 text-danger"
              : "border-open/40 bg-open/10 text-open"
          }`}
        >
          {target}
        </div>
        <div className="text-small text-ink/60">
          {spot.distance_to_entrance_m != null && (
            <p>{spot.distance_to_entrance_m} m walk from the entrance</p>
          )}
        </div>
      </div>

      {stale ? (
        <p className="mt-4 text-small text-danger">
          Someone took this one while you were looking. Tap another free stall.
        </p>
      ) : (
        <p className="mt-4 text-small text-ink/40">
          The route follows the aisles, so it never crosses a row or a median. Stalls are not
          reserved: this is the way there, not a claim on the space.
        </p>
      )}
    </Panel>
  );
}
