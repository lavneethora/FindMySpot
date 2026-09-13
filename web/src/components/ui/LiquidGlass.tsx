import type { ReactNode } from "react";

/**
 * Liquid glass surface for the header pills.
 *
 * Adapted from the 21st.dev liquid-glass-button rather than copied. That component is written
 * for Next.js and shadcn: it opens with "use client", pulls in @radix-ui/react-slot and
 * class-variance-authority, and styles itself from shadcn theme tokens (bg-primary,
 * ring-ring, text-primary-foreground). None of those exist here, so pasted verbatim it would
 * have added two dependencies plus a Button and a MetalButton we have no use for, and then
 * rendered unstyled because the tokens it references are not in our theme.
 *
 * What actually makes the effect is two things, and both are kept:
 *
 *   1. A refraction layer, an SVG turbulence and displacement filter used as a backdrop
 *      filter, so what sits behind the pill is bent rather than merely blurred.
 *   2. A rim of layered inset shadows, which is what reads as a curved glass edge.
 *
 * Two deliberate changes. The displacement scale is 22 rather than 70: theirs is tuned for a
 * 56px button, ours are 28px pills, and a 70px displacement on a 28px element smears the
 * backdrop into mush. And the rim is rebuilt in white rather than black, because this sits on
 * warm paper, not a dark surface.
 */

/** Backdrop filters that reference an SVG filter are not supported everywhere, Safari being
 *  the notable case. The plain blur layer below is separate so that when the reference is
 *  ignored the pill is still frosted rather than flat. */
const REFRACTION = 'url("#liquid-glass")';

/**
 * The three layers, plus the content sitting on top of them.
 *
 * Note what is NOT here: no `isolation: isolate` on the parent and no negative z-index on the
 * layers. Isolating creates a backdrop root, and a backdrop filter inside one samples only
 * what is painted within that root, which for a pill is nothing at all. Both the frost and the
 * refraction would have quietly rendered as blank. Ordering is done with paint order instead,
 * layers first in the DOM, content last and positioned, which needs no stacking context.
 */
export function LiquidSurface({ children }: { children?: ReactNode }) {
  return (
    <>
      {/* Frost. Always applies. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-white/45 backdrop-blur-[6px] backdrop-saturate-150"
      />
      {/* Refraction. Ignored by browsers that cannot resolve the filter reference. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{ backdropFilter: REFRACTION, WebkitBackdropFilter: REFRACTION }}
      />
      {/* The rim. This is the part that actually reads as glass. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_10px_rgba(0,0,0,0.045),inset_1.5px_1.5px_0.5px_-1.5px_rgba(255,255,255,0.95),inset_-1.5px_-1.5px_0.5px_-1.5px_rgba(255,255,255,0.8),inset_0_0_5px_2px_rgba(255,255,255,0.35),inset_0_0_0_1px_rgba(255,255,255,0.55),inset_0_0_0_1.25px_rgba(0,0,0,0.05)]"
      />
      {/* Positioned, and last in the DOM, so it paints over the three layers above. */}
      <span className="relative inline-flex items-center gap-2 whitespace-nowrap">{children}</span>
    </>
  );
}

/** Shared shape for anything wearing the glass. */
export const liquidPill =
  "relative inline-flex h-7 items-center overflow-hidden rounded-full px-3 text-caption font-medium";

/**
 * Defines the filter the refraction layer points at. Render exactly once per page.
 *
 * Turbulence generates noise, the noise displaces the backdrop, and a final blur smooths the
 * result. `hidden` would remove it from the render tree in some engines and take the filter
 * with it, so it is sized to nothing instead.
 */
export function LiquidGlassFilter() {
  return (
    <svg aria-hidden width="0" height="0" className="pointer-events-none absolute">
      <defs>
        <filter id="liquid-glass" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="1.5" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="22"
            xChannelSelector="R"
            yChannelSelector="B"
            result="bent"
          />
          <feGaussianBlur in="bent" stdDeviation="1.2" />
        </filter>
      </defs>
    </svg>
  );
}
