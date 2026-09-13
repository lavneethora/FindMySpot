import type { Layout, ParkState } from "../lib/contract";
import type { Connection } from "../lib/source";
import type { AnalyticsState } from "../hooks/useAnalytics";
import type { LoggedEvent } from "../hooks/useActivityLog";
import { SummaryStrip } from "../components/SummaryStrip";
import { VisionPanel } from "../components/VisionPanel";
import { TwinPanel } from "../components/TwinPanel";
import { AnalyticsStrip } from "../components/AnalyticsStrip";
import { ActivityFeed } from "../components/ActivityFeed";
import { ErrorBoundary } from "../components/ErrorBoundary";

interface OpsViewProps {
  layout: Layout | null;
  state: ParkState | null;
  connection: Connection;
  analytics: AnalyticsState;
  events: LoggedEvent[];
}

/**
 * What an operator sees: the camera the whole thing runs on, the map it produces, how well it
 * is reading the lot, and how the lot gets used over time.
 *
 * The camera and the map sit side by side deliberately. Watching a car leave on the footage and
 * the stall flip on the map in the same moment is the only way to show that one causes the
 * other; describing it does not land the same way.
 *
 * This is the only place footage appears. It is also where the accuracy number belongs, since
 * an operator is the person who would act on it, by recalibrating or moving a camera.
 */
export function OpsView({ layout, state, connection, analytics, events }: OpsViewProps) {
  return (
    <>
      <ErrorBoundary what="The summary">
        <SummaryStrip state={state} showAccuracy />
      </ErrorBoundary>

      <div className="grid xl:grid-cols-2" style={{ gap: "var(--page-gap)" }}>
        <ErrorBoundary what="The camera panel">
          <VisionPanel layout={layout} state={state} connection={connection} />
        </ErrorBoundary>

        <ErrorBoundary what="The map">
          <TwinPanel layout={layout} state={state} />
        </ErrorBoundary>
      </div>

      <ErrorBoundary what="The activity feed">
        <ActivityFeed events={events} />
      </ErrorBoundary>

      <ErrorBoundary what="The analytics strip">
        <AnalyticsStrip analytics={analytics} connection={connection} />
      </ErrorBoundary>
    </>
  );
}
