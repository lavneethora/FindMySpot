import type { HTMLAttributes, ReactNode } from "react";

interface PanelProps extends HTMLAttributes<HTMLElement> {
  /**
   * "glass" frosts the mesh behind it. "solid" is the opaque twin, for panels wrapping
   * content that repaints constantly: the MJPEG feed and the animating twin. A backdrop
   * filter over those makes the compositor re-blur on every repaint.
   */
  tone?: "glass" | "solid";
  padded?: boolean;
  children: ReactNode;
}

export function Panel({ tone = "glass", padded = true, className = "", children, ...rest }: PanelProps) {
  const classes = [tone, "rounded-card", padded ? "p-[26px]" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={classes} {...rest}>
      {children}
    </section>
  );
}

interface PanelHeadProps {
  title: string;
  /** Sits opposite the title. Badges, counts, a control. */
  aside?: ReactNode;
  hint?: string;
}

export function PanelHead({ title, aside, hint }: PanelHeadProps) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="font-display text-heading font-semibold tracking-[-0.01em]">{title}</h2>
        {hint && <p className="mt-1 text-small text-ink/50">{hint}</p>}
      </div>
      {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
    </div>
  );
}
