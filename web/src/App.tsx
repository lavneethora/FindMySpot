import { useState } from "react";
import { useParkTech } from "./hooks/useParkTech";
import { STATUS_ORDER, styleFor, type DisplayStatus } from "./lib/status";
import { Mesh } from "./components/ui/Mesh";
import { Panel, PanelHead } from "./components/ui/Panel";
import { Button } from "./components/ui/Button";
import { Pill, StatusBadge } from "./components/ui/Badge";
import { Stat } from "./components/ui/Stat";

const CONNECTION: Record<string, { copy: string; tone: "neutral" | "live" | "warn" }> = {
  connecting: { copy: "Connecting", tone: "neutral" },
  live: { copy: "Live", tone: "live" },
  mock: { copy: "Mock replay", tone: "neutral" },
  fallback: { copy: "Pipeline dropped", tone: "warn" },
};

export default function App() {
  const { layout, state, connection, error, hold } = useParkTech();
  const [note, setNote] = useState<string | null>(null);

  const best = state?.best_spot ?? null;
  const link = CONNECTION[connection] ?? CONNECTION.connecting;

  const counts = STATUS_ORDER.map((status) => ({
    status,
    count: state ? Object.values(state.spots).filter((s) => s.status === status).length : 0,
  }));

  async function holdBest() {
    if (!best) return;
    try {
      const result = await hold(best);
      const until = new Date(result.held_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setNote(`${result.spot_id} held until ${until}. Route has ${result.route.length} waypoints.`);
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "Hold failed");
    }
  }

  return (
    <>
      <Mesh />
      <div className="mx-auto flex min-h-full max-w-[1200px] flex-col gap-6 px-6 py-10 sm:px-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-display font-semibold">ParkTech</h1>
            <p className="mt-2 text-body text-ink/70">
              {layout?.lot_name ?? "Loading the lot"}
              {layout ? ` · camera ${layout.camera_id}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={link.tone}>{link.copy}</Pill>
            <Pill title="Video never leaves the machine that processes it">Edge only</Pill>
          </div>
        </header>

        <Panel>
          <PanelHead
            title="Right now"
            hint="Counts come straight off the state message, never recomputed in the browser."
            aside={counts.map(({ status, count }) => (
              <StatusBadge key={status} status={status} count={count} />
            ))}
          />
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Available" value={state?.summary.available ?? "--"} tone="var(--color-open)" />
            <Stat label="Occupied" value={state?.summary.occupied ?? "--"} tone="var(--color-taken)" />
            <Stat label="Monitored" value={state?.summary.total ?? "--"} />
            <Stat
              label="Per stall accuracy"
              value={state?.summary.accuracy != null ? `${(state.summary.accuracy * 100).toFixed(1)}%` : "--"}
              note="measured against ground truth"
            />
          </div>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Panel>
            <PanelHead
              title="Status palette"
              hint="Every state carries a word as well as a colour, and the fills separate by lightness so the map still reads with all colour information removed."
            />
            <ul className="grid gap-3">
              {(["available", "held", "occupied", "unknown"] as DisplayStatus[]).map((status) => {
                const style = styleFor(status);
                return (
                  <li key={status} className="flex items-center gap-4">
                    <span
                      className="flex h-12 w-20 shrink-0 items-center justify-center rounded-chip text-caption font-semibold"
                      style={{ backgroundColor: style.fill, color: style.on, border: `1.5px solid ${style.edge}` }}
                    >
                      A7
                    </span>
                    <div>
                      <p className="text-body font-medium" style={{ color: style.ink }}>
                        {style.label}
                      </p>
                      <p className="text-small text-ink/50">
                        {style.pattern ? `flat fill plus a ${style.pattern} pattern` : "flat fill"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel>
            <PanelHead title="Soft hold" hint="Ninety seconds, released early if a car arrives." />
            <dl className="grid gap-3 text-caption">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink/50">Best spot</dt>
                <dd className="tabular font-medium">{best ?? "--"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink/50">Frame</dt>
                <dd className="tabular">
                  {state ? new Date(state.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink/50">Last change</dt>
                <dd className="text-right">
                  {state?.last_event ? `${state.last_event.spot_id} ${state.last_event.to}` : "steady"}
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-col gap-3">
              <Button onClick={holdBest} disabled={!best}>
                Hold {best ?? "best spot"}
              </Button>
              <Button variant="secondary" onClick={() => setNote(null)} disabled={!note}>
                Clear
              </Button>
            </div>

            {note && <p className="mt-4 text-small text-ink/70">{note}</p>}
            {error && <p className="mt-2 text-small text-danger">{error}</p>}
          </Panel>
        </div>

        <p className="text-small text-ink/40">
          Token preview. The two panel shell, the digital twin and the analytics strip land in
          the next changes.
        </p>
      </div>
    </>
  );
}
