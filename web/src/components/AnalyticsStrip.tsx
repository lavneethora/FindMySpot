import type { AnalyticsState } from "../hooks/useAnalytics";
import type { Connection } from "../lib/source";
import { Panel, PanelHead } from "./ui/Panel";
import { Placeholder } from "./ui/Placeholder";
import { Pill } from "./ui/Badge";
import { OccupancyChart } from "./analytics/OccupancyChart";

interface AnalyticsStripProps {
  analytics: AnalyticsState;
  connection: Connection;
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The operator's half of the product: not how full the lot is right now, but how it gets used.
 *
 * Everything here comes out of stored state changes. The lot never had a utilisation history
 * before, and that is the actual claim, so the panel says where the numbers come from rather
 * than presenting them as if they fell from the sky.
 */
export function AnalyticsStrip({ analytics, connection }: AnalyticsStripProps) {
  const { series, loading, error } = analytics;
  const sampled = connection === "mock" || connection === "fallback";

  return (
    <Panel className="flex flex-col">
      <PanelHead
        title="How this lot gets used"
        hint="Built from stored state changes, one row per change, never one per frame."
        aside={
          sampled ? (
            <Pill title="No database connected, so this history is a generated sample">Sample history</Pill>
          ) : series?.bucketMinutes ? (
            <Pill title="Bucket width of the continuous aggregate">{series.bucketMinutes} min buckets</Pill>
          ) : null
        }
      />

      {error && <p className="mb-3 text-small text-danger">{error}</p>}

      {loading && !series ? (
        <Placeholder what="Reading the lot history." ratio="21 / 7" />
      ) : series && series.points.length > 1 ? (
        <>
          <div style={{ aspectRatio: "21 / 7" }}>
            <OccupancyChart series={series} />
          </div>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <dt className="text-small text-ink/50">Peak occupancy</dt>
              <dd className="tabular font-display text-heading font-semibold">
                {series.peak ? `${series.peak.occupied} of ${series.total}` : "--"}
                {series.peak && (
                  <span className="ml-2 text-small font-normal text-ink/40">at {clock(series.peak.time)}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-small text-ink/50">Stall changes</dt>
              <dd className="tabular font-display text-heading font-semibold">{series.events}</dd>
            </div>
            <div>
              <dt className="text-small text-ink/50">Turnover</dt>
              <dd className="tabular font-display text-heading font-semibold">
                {series.turnoverPerStallPerHour.toFixed(2)}
                <span className="ml-2 text-small font-normal text-ink/40">per stall per hour</span>
              </dd>
            </div>
            <div>
              <dt className="text-small text-ink/50">Busiest window</dt>
              <dd className="tabular font-display text-heading font-semibold">
                {series.busiest ? clock(series.busiest.time) : "--"}
                {series.busiest && (
                  <span className="ml-2 text-small font-normal text-ink/40">
                    {series.busiest.arrivals + series.busiest.departures} changes
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-small text-ink/40">
            The curve is the occupancy the pipeline recorded, one reading per frame, stored as
            time series. The bars under it are the stored transition counts, unmodified. Both
            come straight from the database; neither is inferred from the other.
            {series.incomplete && (
              <span className="text-held">
                {" "}
                The window does not contain every change needed to explain the current count, so
                the earliest part of the curve is approximate.
              </span>
            )}
          </p>
        </>
      ) : (
        <Placeholder
          what="No history yet. The curve appears once the pipeline has recorded a few stall changes."
          ratio="21 / 7"
        />
      )}
    </Panel>
  );
}
