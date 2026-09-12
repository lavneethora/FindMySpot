import type { ReactNode } from "react";
import { styleFor, type DisplayStatus } from "../../lib/status";

/**
 * A status badge always spells the status out. The dot is a second channel, not the only
 * one, which is the rule the whole status palette is built on.
 */

interface StatusBadgeProps {
  status: DisplayStatus;
  count?: number;
}

export function StatusBadge({ status, count }: StatusBadgeProps) {
  const style = styleFor(status);
  return (
    <span
      className="inline-flex h-7 items-center gap-2 rounded-full border px-3 text-caption font-medium"
      style={{ borderColor: style.edge, color: style.ink, backgroundColor: "rgb(255 255 255 / 0.5)" }}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ backgroundColor: style.fill, outline: `1px solid ${style.edge}` }}
      />
      {style.short}
      {count !== undefined && <span className="tabular opacity-70">{count}</span>}
    </span>
  );
}

interface PillProps {
  children: ReactNode;
  tone?: "neutral" | "live" | "warn";
  title?: string;
}

const tones = {
  neutral: "border-card-border text-ink/60",
  live: "border-open-edge text-open",
  warn: "border-held-edge text-held",
};

export function Pill({ children, tone = "neutral", title }: PillProps) {
  return (
    <span
      title={title}
      className={`inline-flex h-7 items-center gap-2 rounded-full border bg-white/50 px-3 text-caption font-medium ${tones[tone]}`}
    >
      {tone === "live" && (
        <span aria-hidden className="size-2 animate-hold-pulse rounded-full bg-open-edge" />
      )}
      {children}
    </span>
  );
}
