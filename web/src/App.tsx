import { useState } from "react";
import { useParkTech } from "./hooks/useParkTech";

const panel =
  "rounded-[24px] border border-white/70 bg-white/55 backdrop-blur-xl backdrop-saturate-150 " +
  "shadow-[0_1px_2px_rgba(0,0,0,0.035),0_3px_8px_rgba(0,0,0,0.035),0_8px_28px_rgba(0,0,0,0.043)]";

const label = "text-[13px] leading-[1.4] text-black/50";
const value = "text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] tabular-nums";

const connectionCopy: Record<string, string> = {
  connecting: "Connecting to the pipeline",
  live: "Live from the pipeline",
  mock: "Mock replay, no backend needed",
  fallback: "Pipeline dropped, replaying the fixture",
};

export default function App() {
  const { layout, state, connection, error, hold } = useParkTech();
  const [note, setNote] = useState<string | null>(null);

  const best = state?.best_spot ?? null;

  async function holdBest() {
    if (!best) return;
    try {
      const result = await hold(best);
      setNote(`Held ${result.spot_id} until ${new Date(result.held_until).toLocaleTimeString()}, route has ${result.route.length} waypoints`);
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : "Hold failed");
    }
  }

  return (
    <div className="relative min-h-full overflow-hidden">
      {/* The warm mesh ground. Frosted panels need something behind them worth blurring,
          which is the part light glassmorphism usually gets wrong. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-paper">
        <div className="absolute -top-40 -left-32 h-[40rem] w-[40rem] rounded-full bg-[#F2C879] opacity-40 blur-[120px]" />
        <div className="absolute top-1/4 -right-40 h-[36rem] w-[36rem] rounded-full bg-[#9DBFA4] opacity-35 blur-[130px]" />
        <div className="absolute -bottom-48 left-1/4 h-[32rem] w-[32rem] rounded-full bg-[#E5A98C] opacity-30 blur-[140px]" />
      </div>

      <main className="mx-auto flex min-h-full max-w-[1200px] flex-col justify-center gap-6 px-10 py-16">
        <section className={`${panel} p-[26px]`}>
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-[40px] leading-[1] font-semibold tracking-[-0.04em]">ParkTech</h1>
            <p className={label}>
              {layout?.lot_name ?? "Loading"} · {connectionCopy[connection] ?? connection}
            </p>
          </div>

          <div className="mt-7 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <div>
              <p className={value}>{state?.summary.available ?? "--"}</p>
              <p className={label}>Available</p>
            </div>
            <div>
              <p className={value}>{state?.summary.occupied ?? "--"}</p>
              <p className={label}>Occupied</p>
            </div>
            <div>
              <p className={value}>{state?.summary.total ?? "--"}</p>
              <p className={label}>Monitored</p>
            </div>
            <div>
              <p className={value}>
                {state?.summary.accuracy != null ? `${(state.summary.accuracy * 100).toFixed(1)}%` : "--"}
              </p>
              <p className={label}>Accuracy</p>
            </div>
          </div>
        </section>

        <section className={`${panel} p-[26px]`}>
          <p className={label}>Plumbing check. Replaced by the real shell in the next change.</p>
          <dl className="mt-4 grid gap-2 text-[14px] tabular-nums">
            <div className="flex justify-between gap-4">
              <dt className="text-black/50">Frame timestamp</dt>
              <dd>{state?.timestamp ?? "--"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-black/50">Best spot</dt>
              <dd>{best ?? "--"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-black/50">Last event</dt>
              <dd>
                {state?.last_event
                  ? `${state.last_event.spot_id}: ${state.last_event.from} to ${state.last_event.to}`
                  : "none this tick"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-black/50">Tracked cars</dt>
              <dd>
                {state?.cars.map((car) => `#${car.id} ${car.x.toFixed(3)},${car.y.toFixed(3)}`).join("   ") ?? "--"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-black/50">Layout stalls</dt>
              <dd>{layout ? Object.keys(layout.spots).length : "--"}</dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={holdBest}
            disabled={!best}
            className="mt-6 h-10 rounded-[14px] bg-gradient-to-b from-[#3A3A3A] to-[#353535] px-4 text-[16px] font-medium text-white shadow-[0_0.5px_1px_rgba(0,0,0,0.08),0_1px_3px_rgba(0,0,0,0.1),0_4px_12px_rgba(0,0,0,0.08),inset_0_0_0_1.25px_#353535,inset_0_0_12px_rgba(255,255,255,0.1)] transition-[transform,filter] duration-150 ease-out hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            Hold {best ?? "best spot"}
          </button>

          {note && <p className="mt-3 text-[14px] text-black/70">{note}</p>}
          {error && <p className="mt-3 text-[14px] text-[#B3261E]">{error}</p>}
        </section>
      </main>
    </div>
  );
}
