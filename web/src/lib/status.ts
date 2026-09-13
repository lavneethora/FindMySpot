/**
 * One place that decides how a stall status looks and what it is called.
 *
 * Colour is never the only channel. Every status also carries a word, and the two states a
 * viewer could otherwise confuse carry a fill pattern too. The fills are separated by
 * lightness as well as hue, so the map survives total colour loss. See the long comment on
 * the status tokens in index.css for the measured numbers.
 */

import type { SpotStatus } from "./contract";

export type DisplayStatus = SpotStatus | "unknown";

export interface StatusStyle {
  /** Full word, for legends, tooltips and screen readers. */
  label: string;
  /** Single word for dense places like a stall tooltip. */
  short: string;
  fill: string;
  edge: string;
  /** Ink on paper, for text and icons outside the stall. */
  ink: string;
  /** Ink on top of the fill, for the stall label itself. */
  on: string;
  /**
   * SVG pattern layered over the fill, or null for a flat fill. Only the states that are
   * close in lightness carry one, so the common case stays clean and the map does not turn
   * into noise with 28 stalls on screen.
   */
  pattern: "stripe" | "crosshatch" | null;
}

export const STATUS: Record<DisplayStatus, StatusStyle> = {
  available: {
    label: "Available",
    short: "Open",
    fill: "var(--color-open-fill)",
    edge: "var(--color-open-edge)",
    ink: "var(--color-open)",
    on: "var(--color-open-on)",
    pattern: null,
  },
  occupied: {
    label: "Occupied",
    short: "Taken",
    fill: "var(--color-taken-fill)",
    edge: "var(--color-taken-edge)",
    ink: "var(--color-taken)",
    on: "var(--color-taken-on)",
    pattern: null,
  },
  held: {
    label: "Held for you",
    short: "Held",
    fill: "var(--color-held-fill)",
    edge: "var(--color-held-edge)",
    ink: "var(--color-held)",
    on: "var(--color-held-on)",
    pattern: "stripe",
  },
  unknown: {
    label: "No reading",
    short: "Unknown",
    fill: "var(--color-unknown-fill)",
    edge: "var(--color-unknown-edge)",
    ink: "var(--color-unknown)",
    on: "var(--color-unknown-on)",
    pattern: "crosshatch",
  },
};

export function styleFor(status: DisplayStatus | undefined): StatusStyle {
  return STATUS[status ?? "unknown"] ?? STATUS.unknown;
}

/** Order used by the legend and the summary row: best news first. */
export const STATUS_ORDER: DisplayStatus[] = ["available", "held", "occupied"];
