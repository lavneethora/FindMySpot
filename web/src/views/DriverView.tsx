import type { Layout, ParkState } from "../lib/contract";
import type { HoldState } from "../hooks/useHold";
import { SummaryStrip } from "../components/SummaryStrip";
import { TwinPanel } from "../components/TwinPanel";
import { HoldCard } from "../components/HoldCard";
import { ErrorBoundary } from "../components/ErrorBoundary";

interface DriverViewProps {
  layout: Layout | null;
  state: ParkState | null;
  holding: HoldState;
  onSelect: (spotId: string) => void;
}

/**
 * What a driver sees: where the free stalls are, which one to take, and how to reach it.
 *
 * No camera panel here, deliberately. Streaming footage of a car park to every driver would
 * contradict the privacy claim the whole product rests on, that only occupancy state ever
 * leaves the device. The footage exists so the operator can audit the detector; it is not the
 * product. Detector accuracy is left out for the same reason: it is a number a driver cannot
 * act on and would only invite doubt.
 */
export function DriverView({ layout, state, holding, onSelect }: DriverViewProps) {
  return (
    <>
      <ErrorBoundary what="The summary">
        <SummaryStrip state={state} />
      </ErrorBoundary>

      {/* The map is the product, so it gets the room. The hold card sits beside it on a wide
          screen and underneath it on a narrow one. */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem]" style={{ gap: "var(--page-gap)" }}>
        <ErrorBoundary what="The map">
          <TwinPanel
            layout={layout}
            state={state}
            heldSpot={holding.hold?.spotId ?? null}
            route={holding.hold?.route}
            onSelect={onSelect}
          />
        </ErrorBoundary>

        <ErrorBoundary what="The hold card">
          <HoldCard layout={layout} state={state} holding={holding} />
        </ErrorBoundary>
      </div>
    </>
  );
}
