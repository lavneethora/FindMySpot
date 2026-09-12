import { useCallback, useEffect, useState } from "react";
import type { Hold, ParkState, Point, SpotStatus } from "../lib/contract";

export type HoldVerdict = "keep" | "confirm" | "release";

/**
 * Given what the server last said about the stall, decide what happens to the hold.
 *
 * Pulled out of the effect so it can be tested directly, because the race it exists to solve
 * is subtle: the claim resolves before the next state message arrives, so for one tick the
 * stall still reads "available". Treating that as a refusal would cancel every hold instantly.
 *
 * Rules: no information is never a reason to release. Only an affirmative status that is not
 * "held", seen after the hold has been confirmed at least once, releases it. Anything else is
 * left to the expiry timer.
 */
export function holdVerdict(status: SpotStatus | undefined, confirmed: boolean): HoldVerdict {
  if (status === undefined) return "keep";
  if (status === "held") return confirmed ? "keep" : "confirm";
  return confirmed ? "release" : "keep";
}

export interface ActiveHold {
  spotId: string;
  heldUntil: number;
  route: Point[];
}

export interface HoldState {
  hold: ActiveHold | null;
  /** The stall a request is in flight for, so the button can show it is working. */
  pending: string | null;
  error: string | null;
  secondsLeft: number;
  claim: (spotId: string) => Promise<void>;
  release: () => void;
}

/**
 * Owns one driver's soft hold.
 *
 * A hold ends three ways: it expires, the camera sees a car arrive, or the driver lets it go.
 * The server is the authority on the first two, so this watches the state stream rather than
 * trusting its own timer alone. The timer only drives the countdown.
 */
export function useHold(place: (spotId: string) => Promise<Hold>, state: ParkState | null): HoldState {
  const [hold, setHold] = useState<ActiveHold | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /**
   * Whether the state stream has caught up and shown this stall as held.
   *
   * Without this the hold cancels itself immediately: the claim resolves before the next
   * state message arrives, so for one tick the stall still reads "available" and a naive
   * check would take that as the server refusing. Only a status change seen *after* the hold
   * has been confirmed counts as a release.
   */
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!hold) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [hold]);

  useEffect(() => {
    if (hold && now >= hold.heldUntil) {
      setHold(null);
      setConfirmed(false);
    }
  }, [hold, now]);

  useEffect(() => {
    if (!hold || !state) return;
    const verdict = holdVerdict(state.spots[hold.spotId]?.status, confirmed);
    if (verdict === "confirm") setConfirmed(true);
    if (verdict === "release") {
      setHold(null);
      setConfirmed(false);
    }
  }, [hold, state, confirmed]);

  const claim = useCallback(
    async (spotId: string) => {
      setPending(spotId);
      setError(null);
      try {
        const result = await place(spotId);
        setHold({
          spotId: result.spot_id,
          heldUntil: new Date(result.held_until).getTime(),
          route: result.route ?? [],
        });
        setConfirmed(false);
        setNow(Date.now());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : `Could not hold ${spotId}`);
      } finally {
        setPending(null);
      }
    },
    [place],
  );

  const release = useCallback(() => {
    setHold(null);
    setConfirmed(false);
  }, []);

  return {
    hold,
    pending,
    error,
    secondsLeft: hold ? Math.max(0, Math.ceil((hold.heldUntil - now) / 1000)) : 0,
    claim,
    release,
  };
}
