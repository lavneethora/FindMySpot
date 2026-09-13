import { useCallback, useState } from "react";
import { useParkTech } from "./hooks/useParkTech";
import { useActivityLog } from "./hooks/useActivityLog";
import { useRoutes } from "./hooks/useRoutes";
import { useAnalytics } from "./hooks/useAnalytics";
import { useRoute } from "./lib/router";
import { Mesh } from "./components/ui/Mesh";
import { AppHeader } from "./components/AppHeader";
import { DriverView } from "./views/DriverView";
import { OpsView } from "./views/OpsView";

export default function App() {
  const { layout, state, connection, error, hold, fetchAnalytics } = useParkTech();
  const events = useActivityLog(state);
  // Which stall the driver is being shown the way to. Not a reservation: nothing physically
  // stops another car taking it, so the product does not pretend to hold it.
  const [selected, setSelected] = useState<string | null>(null);
  const routes = useRoutes(selected ?? state?.best_spot ?? null, connection === "mock");
  const analytics = useAnalytics(fetchAnalytics, state);
  const [route, navigate] = useRoute();

  // Stable, so the memoized stall layer is not invalidated on every state message.
  const onSelect = useCallback((spotId: string) => setSelected(spotId), []);

  return (
    <>
      <Mesh />

      {/* 1440 rather than the 1200 in DESIGN.md. That limit exists to keep prose line lengths
          readable on a marketing page, which does not apply to a full width lot map. */}
      <div
        className="mx-auto flex min-h-full max-w-[1440px] flex-col px-6 sm:px-10"
        style={{ gap: "var(--page-gap)", paddingBlock: "var(--page-pad)" }}
      >
        <AppHeader
          layout={layout}
          state={state}
          connection={connection}
          route={route}
          onNavigate={navigate}
        />

        {error && (
          <p role="alert" className="rounded-chip border border-danger/30 bg-white/60 px-4 py-3 text-small text-danger">
            {error}
          </p>
        )}

        {/* The state, the hold and the history are held here rather than inside a view, so
            switching views does not drop the WebSocket, reset a live hold, or refetch the
            history. Only the layout changes. */}
        {route === "ops" ? (
          <OpsView
            layout={layout}
            state={state}
            connection={connection}
            analytics={analytics}
            events={events}
          />
        ) : (
          <DriverView
            layout={layout}
            state={state}
            selected={selected}
            route={routes.primary}
            otherRoutes={routes.others}
            onSelect={onSelect}
          />
        )}

        <footer className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink/35">
          {route === "ops" ? (
            <>
              <span>Footage is the PKLot benchmark, not the Innovation Hub.</span>
              <span>Accuracy is measured against the dataset's own ground truth.</span>
            </>
          ) : (
            <span>Only occupancy state leaves the camera. No faces, no plates, no stored video.</span>
          )}
        </footer>
      </div>
    </>
  );
}
