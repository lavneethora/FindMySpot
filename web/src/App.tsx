import { useCallback, useState } from "react";
import { useParkTech } from "./hooks/useParkTech";
import { useActivityLog } from "./hooks/useActivityLog";
import { useRoutes } from "./hooks/useRoutes";
import { useAnalytics } from "./hooks/useAnalytics";
import { useRoute } from "./lib/router";
import { Mesh } from "./components/ui/Mesh";
import { LiquidGlassFilter } from "./components/ui/LiquidGlass";
import { AppHeader } from "./components/AppHeader";
import { DriverView } from "./views/DriverView";
import { OpsView } from "./views/OpsView";

export default function App() {
  const { layout, state, connection, error, hold, fetchAnalytics } = useParkTech();
  const events = useActivityLog(state);
  // Which stall the driver is being shown the way to. Not a reservation: nothing physically
  // stops another car taking it, so the product does not pretend to hold it.
  const [selected, setSelected] = useState<string | null>(null);
  // Only once a stall is chosen. Routing to the closest free stall on load drew a path
  // nobody asked for, and made the map look like it had already decided for the driver.
  const routes = useRoutes(selected, connection === "mock");
  const analytics = useAnalytics(fetchAnalytics, state);
  const [route, navigate] = useRoute();

  // Stable, so the memoized stall layer is not invalidated on every state message.
  const onSelect = useCallback((spotId: string) => setSelected(spotId), []);

  return (
    <>
      <Mesh />
      {/* Defined once for the whole page. Every glass pill points its backdrop filter here. */}
      <LiquidGlassFilter />

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
            route={routes.entrance}
            drivers={routes.drivers}
            onSelect={onSelect}
          />
        )}

        {/* The operator footer carried the benchmark and ground truth notes. Both are said out
            loud in the pitch and both live on the honesty slide, so on screen they were
            duplication under a panel nobody reads. The privacy line stays on the driver view,
            where it is the one claim a driver has no other way to check. */}
        {route !== "ops" && (
          <footer className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink/35">
            <span>Only occupancy state leaves the camera. No faces, no plates, no stored video.</span>
          </footer>
        )}
      </div>
    </>
  );
}
