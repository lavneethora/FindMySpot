import type { ReactNode } from "react";

interface StatProps {
  label: string;
  value: ReactNode;
  /** Sits under the value. Units, a comparison, a caveat. */
  note?: string;
  /** Token colour for the value, for example var(--color-open). Defaults to ink. */
  tone?: string;
}

/**
 * A number that changes in place. Tabular figures are not decoration here: without them the
 * available count jitters the layout every time a stall flips, which reads as a bug.
 */
export function Stat({ label, value, note, tone }: StatProps) {
  return (
    <div>
      <p className="tabular font-display text-metric font-semibold" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
      <p className="mt-1 text-small text-ink/50">{label}</p>
      {note && <p className="text-small text-ink/40">{note}</p>}
    </div>
  );
}
