import { useCallback } from "react";
import { useParkTech } from "./hooks/useParkTech";
import { useActivityLog } from "./hooks/useActivityLog";
import { useHold } from "./hooks/useHold";
import { Mesh } from "./components/ui/Mesh";
import { AppHeader } from "./components/AppHeader";
import { SummaryStrip } from "./components/SummaryStrip";
import { VisionPanel } from "./components/VisionPanel";
import { TwinPanel } from "./components/TwinPanel";
import { AnalyticsStrip } from "./components/AnalyticsStrip";
import { ActivityFeed } from "./components/ActivityFeed";
import { HoldCard } from "./components/HoldCard";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  const { layout, state, connection, error, hold } = useParkTech();
  const events = useActivityLog(state);
  const holding = useHold(hold, state);

  // Stable, so the memoized stall layer is not invalidated on every state message.
  const onSelect = useCallback((spotId: string) => void holding.claim(spotId), [holding.claim]);

  return (
    <>
      <Mesh />

      {/* 1440 rather than the 1200 in DESIGN.md. That limit exists to keep prose line lengths
          readable on a marketing page, which does not apply to two side by side map panels:
          at 1200 each panel drops under 560px and the twin starts losing stall labels. */}
      <div
        className="mx-auto flex min-h-full max-w-[1440px] flex-col px-6 sm:px-10"
        style={{ gap: "var(--page-gap)", paddingBlock: "var(--page-pad)" }}
      >
        <AppHeader layout={layout} state={state} connection={connection} />

        {error && (
          <p role="alert" className="rounded-chip border border-danger/30 bg-white/60 px-4 py-3 text-small text-danger">
            {error}
          </p>
        )}

        <ErrorBoundary what="The summary">
          <SummaryStrip state={state} />
        </ErrorBoundary>

        {/* The demo moment is watching a car leave on the left while the stall flips on the
            right, so these two stay adjacent and equal until the viewport is genuinely narrow. */}
        {/* Boundaries go around each panel separately. One around the pair would still take
            both out, and the whole point is that the other half keeps running. */}
        <div className="grid xl:grid-cols-2" style={{ gap: "var(--page-gap)" }}>
          <ErrorBoundary what="The camera panel">
            <VisionPanel layout={layout} state={state} connection={connection} />
          </ErrorBoundary>
          <ErrorBoundary what="The digital twin">
            <TwinPanel
              layout={layout}
              state={state}
              heldSpot={holding.hold?.spotId ?? null}
              route={holding.hold?.route}
              onSelect={onSelect}
            />
          </ErrorBoundary>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem]" style={{ gap: "var(--page-gap)" }}>
          <ErrorBoundary what="The analytics strip">
            <AnalyticsStrip />
          </ErrorBoundary>
          <div className="flex flex-col" style={{ gap: "var(--page-gap)" }}>
            <ErrorBoundary what="The hold card">
              <HoldCard layout={layout} state={state} holding={holding} />
            </ErrorBoundary>
            <ErrorBoundary what="The activity feed">
              <ActivityFeed events={events} />
            </ErrorBoundary>
          </div>
        </div>

        <footer className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink/35">
          <span>Footage is the PKLot benchmark, not the Innovation Hub.</span>
          <span>Accuracy is measured against the dataset's own ground truth.</span>
        </footer>
      </div>
    </>
  );
}
