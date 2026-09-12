import type { LoggedEvent } from "../hooks/useActivityLog";
import { styleFor } from "../lib/status";
import { Panel, PanelHead } from "./ui/Panel";

interface ActivityFeedProps {
  events: LoggedEvent[];
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  return (
    <Panel className="flex flex-col">
      <PanelHead title="Activity" hint="Every stall change, newest first." />

      {events.length === 0 ? (
        <p className="text-small text-ink/40">Nothing has changed yet. Watching.</p>
      ) : (
        /* Polite rather than assertive: a stall freeing is worth announcing, but it must not
           interrupt someone mid sentence. */
        <ul className="flex flex-col gap-2" aria-live="polite" aria-relevant="additions">
          {events.map((event, index) => {
            const to = styleFor(event.to);
            const from = styleFor(event.from);
            return (
              <li
                key={event.key}
                className="flex items-center gap-3 rounded-chip border border-card-border/70 bg-white/45 px-3 py-2"
                /* Older entries recede rather than vanish, so the eye lands on the newest. */
                style={{ opacity: Math.max(0.45, 1 - index * 0.09) }}
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: to.fill, outline: `1px solid ${to.edge}` }}
                />
                <span className="tabular text-caption font-semibold">{event.spot_id}</span>
                <span className="text-small text-ink/50">
                  {from.short} to <span style={{ color: to.ink }}>{to.short.toLowerCase()}</span>
                </span>
                <span className="tabular ml-auto text-small text-ink/35">{clock(event.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
