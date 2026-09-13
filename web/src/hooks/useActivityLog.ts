import { useEffect, useRef, useState } from "react";
import type { ParkState, Transition } from "../lib/contract";

export interface LoggedEvent extends Transition {
  /** Lot clock, from the frame this transition was seen in. */
  at: string;
  /** Wall clock arrival, used only to order and expire entries. */
  received: number;
  key: string;
}

const LIMIT = 12;

/**
 * Accumulates the transitions that arrive one at a time on `last_event`.
 *
 * The mock emits at 8 Hz and the live socket pushes on every change, so the same transition
 * can be seen more than once. Entries are keyed on frame timestamp plus stall plus target
 * state, which is enough to make a repeat idempotent without holding the whole history.
 */
export function useActivityLog(state: ParkState | null): LoggedEvent[] {
  const [events, setEvents] = useState<LoggedEvent[]>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const event = state?.last_event;
    if (!event || !state) return;

    const key = `${state.timestamp}:${event.spot_id}:${event.to}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);

    setEvents((previous) => {
      const next = [{ ...event, at: state.timestamp, received: Date.now(), key }, ...previous];
      // Drop the keys of anything that falls off the end, or the set grows forever across a
      // long replay.
      for (const stale of next.slice(LIMIT)) seen.current.delete(stale.key);
      return next.slice(0, LIMIT);
    });
  }, [state]);

  return events;
}
