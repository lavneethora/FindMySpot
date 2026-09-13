import type { Layout, ParkState } from "../lib/contract";
import type { HoldState } from "../hooks/useHold";
import { Panel, PanelHead } from "./ui/Panel";
import { Button } from "./ui/Button";
import { styleFor } from "../lib/status";

interface HoldCardProps {
  layout: Layout | null;
  state: ParkState | null;
  holding: HoldState;
}

const HOLD_SECONDS = 90;

/**
 * The driver's side of the product: which stall to take, and a claim on it that stops two
 * people racing for the same space.
 */
export function HoldCard({ layout, state, holding }: HoldCardProps) {
  const { hold, pending, error, secondsLeft, claim, release } = holding;
  const best = state?.best_spot ?? null;
  const held = styleFor("held");

  const walk = (spotId: string | null) =>
    spotId != null ? layout?.spots[spotId]?.distance_to_entrance_m : undefined;

  if (hold) {
    const distance = walk(hold.spotId);
    const fraction = Math.max(0, Math.min(1, secondsLeft / HOLD_SECONDS));

    return (
      <Panel>
        <PanelHead title="Your stall" hint="Nobody else is offered this stall while you hold it." />

        <div className="flex items-center gap-4">
          <span
            className="flex h-16 w-20 shrink-0 items-center justify-center rounded-chip font-display text-title font-semibold"
            style={{ backgroundColor: held.fill, color: held.on, border: `2px solid ${held.edge}` }}
          >
            {hold.spotId}
          </span>
          <div>
            <p className="tabular text-body font-medium" style={{ color: held.ink }}>
              {secondsLeft}s remaining
            </p>
            <p className="text-small text-ink/50">
              {distance != null ? `${distance} m walk from the entrance` : "Route shown on the map"}
            </p>
          </div>
        </div>

        {/* A bar rather than only a number: at a glance from across a room, a shrinking bar
            reads faster than a counting digit. */}
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface" role="presentation">
          <div
            className="h-full rounded-full"
            style={{
              width: `${fraction * 100}%`,
              backgroundColor: held.edge,
              transition: "width 250ms linear",
            }}
          />
        </div>
        <p className="sr-only" aria-live="polite">
          {`Stall ${hold.spotId} held, ${secondsLeft} seconds remaining`}
        </p>

        <Button variant="secondary" className="mt-5 w-full" onClick={release}>
          Give it up
        </Button>
      </Panel>
    );
  }

  const distance = walk(best);

  return (
    <Panel>
      <PanelHead title="Take this one" hint="Closest free stall to the entrance, held for 90 seconds." />

      {best ? (
        <>
          <div className="flex items-center gap-4">
            <span
              className="flex h-16 w-20 shrink-0 items-center justify-center rounded-chip font-display text-title font-semibold"
              style={{
                backgroundColor: styleFor("available").fill,
                color: styleFor("available").on,
                border: `2px solid ${styleFor("available").edge}`,
              }}
            >
              {best}
            </span>
            <p className="text-small text-ink/50">
              {distance != null ? `${distance} m walk from the entrance` : "Nearest available stall"}
            </p>
          </div>

          <Button className="mt-5 w-full" onClick={() => claim(best)} disabled={pending !== null}>
            {pending === best ? "Holding..." : `Hold ${best}`}
          </Button>
          <p className="mt-3 text-small text-ink/40">Or click any free stall on the map.</p>
        </>
      ) : (
        <p className="text-small text-ink/50">The lot is full. Nothing to hold right now.</p>
      )}

      {error && <p className="mt-3 text-small text-danger">{error}</p>}
    </Panel>
  );
}
