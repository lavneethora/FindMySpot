interface PlaceholderProps {
  /** What will live here, in the user's language, not the branch name. */
  what: string;
  /** Aspect ratio box so the shell holds its final shape before the content exists. */
  ratio?: string;
}

/**
 * A deliberate empty state, not a broken one. The shell should hold its final proportions
 * from the first change, so laying out the twin and the analytics chart later does not shove
 * everything else around.
 */
export function Placeholder({ what, ratio = "16 / 10" }: PlaceholderProps) {
  return (
    <div
      className="flex items-center justify-center rounded-panel border border-dashed border-card-border bg-surface/40"
      style={{ aspectRatio: ratio }}
    >
      <p className="px-6 text-center text-small text-ink/40">{what}</p>
    </div>
  );
}
