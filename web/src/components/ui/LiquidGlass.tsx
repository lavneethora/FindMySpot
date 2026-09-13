import type { ReactNode } from "react";

/**
 * Liquid glass surface for the header pills.
 *
 * Adapted from the 21st.dev liquid-glass-button rather than copied. That component is written
 * for Next.js and shadcn: it opens with "use client", pulls in @radix-ui/react-slot and
 * class-variance-authority, and styles itself from shadcn theme tokens (bg-primary, ring-ring,
 * text-primary-foreground). None of those exist here, so pasted verbatim it would have added
 * two dependencies plus a Button and a MetalButton we have no use for, and then rendered
 * unstyled because the tokens it references are not in our theme.
 *
 * WHY THE FIRST ATTEMPT WAS INVISIBLE, since it is the whole problem with glass on a light UI:
 *
 * A backdrop filter can only show you what is behind it. These pills sit top right, and the
 * mesh blooms sit top left, mid right and bottom, so the backdrop under them was flat cream.
 * Refracting a uniform field produces a uniform field. The markup was correct and the effect
 * was real; there was simply nothing there to bend.
 *
 * So the look no longer depends on the backdrop. The rim and the sheen are painted, not
 * sampled, and carry the glass on their own. The refraction is now the bonus it always should
 * have been, which also covers browsers that cannot resolve an SVG filter reference in
 * backdrop-filter at all. A bloom was added behind the header to give it something to work on.
 */

/** Not supported everywhere, Safari being the notable case. Everything below still reads. */
const REFRACTION = 'url("#liquid-glass")';

/**
 * The layers, plus the content sitting on top of them.
 *
 * Note what is NOT here: no `isolation: isolate` on the parent and no negative z-index. Per the
 * Filter Effects spec, isolating creates a backdrop root, and a backdrop filter inside one
 * samples only what is painted within that root, which for a pill is nothing at all. Ordering
 * is done with paint order instead, layers first in the DOM, content last and positioned.
 */
export function LiquidSurface({ children }: { children?: ReactNode }) {
  return (
    <>
      {/* Frost. Always applies, and saturating the backdrop is what stops it going grey. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-white/30 backdrop-blur-[10px] backdrop-saturate-[1.9] backdrop-brightness-[1.04]"
      />

      {/* Refraction. Silently ignored where the filter reference cannot be resolved. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{ backdropFilter: REFRACTION, WebkitBackdropFilter: REFRACTION }}
      />

      {/* Specular sheen. A painted highlight running off the top left corner, which is what
          makes a curved surface read as curved regardless of what is behind it. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          backgroundImage:
            "linear-gradient(135deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.28) 26%, rgba(255,255,255,0) 52%, rgba(255,255,255,0.10) 78%, rgba(255,255,255,0.38) 100%)",
        }}
      />

      {/* The rim. Bright top edge, darker inner underside, soft lift beneath. This is the part
          doing most of the work now. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full shadow-[0_1px_1px_rgba(0,0,0,0.04),0_6px_16px_rgba(0,0,0,0.10),0_14px_30px_rgba(0,0,0,0.06),inset_0_1px_0.5px_rgba(255,255,255,0.98),inset_1px_0_0.5px_rgba(255,255,255,0.65),inset_-1px_0_0.5px_rgba(255,255,255,0.5),inset_0_-1px_0.5px_rgba(0,0,0,0.12),inset_0_0_0_1px_rgba(255,255,255,0.5),inset_0_9px_14px_-9px_rgba(255,255,255,0.95),inset_0_-9px_14px_-9px_rgba(0,0,0,0.18)]"
      />

      {/* Positioned, and last in the DOM, so it paints over every layer above. */}
      <span className="relative inline-flex items-center gap-2 whitespace-nowrap">{children}</span>
    </>
  );
}

/**
 * Shared shape for anything wearing the glass.
 *
 * 40px tall, which is what DESIGN.md specifies for a control and states as the minimum touch
 * target. The previous 28px was below the design system's own floor, and too small for a
 * curved rim to be legible at arm's length, let alone across a room at judging.
 */
export const liquidPill =
  "relative inline-flex h-10 items-center overflow-hidden rounded-full px-4 text-nav font-medium";

/**
 * Defines the filter the refraction layer points at. Render exactly once per page.
 *
 * Low base frequency on purpose: at roughly one wave per hundred pixels a 40px pill sees less
 * than a full cycle, so the backdrop bends like a lens instead of boiling like noise. `hidden`
 * would drop it from the render tree in some engines and take the filter with it, so it is
 * sized to nothing instead.
 */
export function LiquidGlassFilter() {
  return (
    <svg aria-hidden width="0" height="0" className="pointer-events-none absolute">
      <defs>
        <filter id="liquid-glass" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="4" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="1" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="36"
            xChannelSelector="R"
            yChannelSelector="B"
            result="bent"
          />
          <feGaussianBlur in="bent" stdDeviation="0.8" />
        </filter>
      </defs>
    </svg>
  );
}
