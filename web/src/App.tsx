import { useParkTech } from "./hooks/useParkTech";
import { useActivityLog } from "./hooks/useActivityLog";
import { Mesh } from "./components/ui/Mesh";
import { AppHeader } from "./components/AppHeader";
import { SummaryStrip } from "./components/SummaryStrip";
import { VisionPanel } from "./components/VisionPanel";
import { TwinPanel } from "./components/TwinPanel";
import { AnalyticsStrip } from "./components/AnalyticsStrip";
import { ActivityFeed } from "./components/ActivityFeed";

export default function App() {
  const { layout, state, connection, error } = useParkTech();
  const events = useActivityLog(state);

  return (
    <>
      <Mesh />

      {/* 1440 rather than the 1200 in DESIGN.md. That limit exists to keep prose line lengths
          readable on a marketing page, which does not apply to two side by side map panels:
          at 1200 each panel drops under 560px and the twin starts losing stall labels. */}
      <div className="mx-auto flex min-h-full max-w-[1440px] flex-col gap-5 px-6 py-8 sm:px-10">
        <AppHeader layout={layout} state={state} connection={connection} />

        {error && (
          <p role="alert" className="rounded-chip border border-danger/30 bg-white/60 px-4 py-3 text-small text-danger">
            {error}
          </p>
        )}

        <SummaryStrip state={state} />

        {/* The demo moment is watching a car leave on the left while the stall flips on the
            right, so these two stay adjacent and equal until the viewport is genuinely narrow. */}
        <div className="grid gap-5 xl:grid-cols-2">
          <VisionPanel layout={layout} state={state} connection={connection} />
          <TwinPanel layout={layout} state={state} />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <AnalyticsStrip />
          <ActivityFeed events={events} />
        </div>

        <footer className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink/35">
          <span>Footage is the PKLot benchmark, not the Innovation Hub.</span>
          <span>Accuracy is measured against the dataset's own ground truth.</span>
        </footer>
      </div>
    </>
  );
}
