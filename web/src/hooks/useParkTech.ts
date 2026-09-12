/**
 * The single place the UI reads live state from. One source, created once, torn down on
 * unmount. Nothing below this hook knows whether the data came from Python or the fixture.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Hold, Layout, ParkState } from "../lib/contract";
import { createSource, type Connection, type Source } from "../lib/source";

export interface ParkTech {
  layout: Layout | null;
  state: ParkState | null;
  connection: Connection;
  /** Non fatal problems worth showing in the UI rather than swallowing. */
  error: string | null;
  hold: (spotId: string) => Promise<Hold>;
}

export function useParkTech(): ParkTech {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [state, setState] = useState<ParkState | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const source = useRef<Source | null>(null);

  useEffect(() => {
    // StrictMode mounts effects twice in development, so this has to be safe to run twice.
    const active = createSource();
    source.current = active;
    let live = true;

    active
      .getLayout()
      .then((next) => {
        if (live) setLayout(next);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : "Could not load the lot layout");
      });

    active.start(
      (next) => {
        if (live) setState(next);
      },
      (next) => {
        if (live) setConnection(next);
      },
    );

    return () => {
      live = false;
      active.stop();
      source.current = null;
    };
  }, []);

  const hold = useCallback(async (spotId: string): Promise<Hold> => {
    const active = source.current;
    if (!active) throw new Error("Not connected yet");
    try {
      const result = await active.hold(spotId);
      setError(null);
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `Could not hold ${spotId}`;
      setError(message);
      throw cause;
    }
  }, []);

  return { layout, state, connection, error, hold };
}
