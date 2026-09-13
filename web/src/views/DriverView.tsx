import type { Layout, ParkState, Point } from "../lib/contract";
import { SummaryStrip } from "../components/SummaryStrip";
import { TwinPanel } from "../components/TwinPanel";
import { RouteCard } from "../components/RouteCard";
import { ErrorBoundary } from "../components/ErrorBoundary";

interface DriverViewProps {
  layout: Layout | null;
  state: ParkState | null;
  selected: string | null;
  route: Point[];
  otherRoutes: Point[][];
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
 *
 * Stalls are not reserved either. A hold used to let a driver claim one for ninety seconds,
 * which was fiction: nothing physically stops another car taking the space. Showing the way to
 * a free stall is a promise the product can keep, so that is all it makes.
 */
export function DriverView({ layout, state, selected, route, otherRoutes, onSelect }: DriverViewProps) {
  return (
    <>
      <ErrorBoundary what="The summary">
        <SummaryStrip state={state} />
      </ErrorBoundary>

      {/* The map is the product, so it gets the room. The route card sits beside it on a wide
          screen and underneath it on a narrow one. */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem]" style={{ gap: "var(--page-gap)" }}>
        <ErrorBoundary what="The map">
          <TwinPanel
            layout={layout}
            state={state}
            heldSpot={selected}
            route={route}
            otherRoutes={otherRoutes}
            onSelect={onSelect}
          />
        </ErrorBoundary>

        <ErrorBoundary what="The route card">
          <RouteCard layout={layout} state={state} selected={selected} />
        </ErrorBoundary>
      </div>
    </>
  );
}
