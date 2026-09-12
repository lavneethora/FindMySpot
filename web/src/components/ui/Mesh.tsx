/**
 * The warm mesh ground. Purely decorative, and the reason the frosted panels have anything
 * to blur. Fixed rather than scrolled, so the blooms do not slide under the panels.
 */
export function Mesh() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-paper">
      <div className="absolute -top-40 -left-32 h-[40rem] w-[40rem] rounded-full bg-bloom-amber opacity-40 blur-[120px]" />
      <div className="absolute top-1/4 -right-40 h-[36rem] w-[36rem] rounded-full bg-bloom-sage opacity-35 blur-[130px]" />
      <div className="absolute -bottom-48 left-1/4 h-[32rem] w-[32rem] rounded-full bg-bloom-clay opacity-30 blur-[140px]" />
      {/* A whisper of grain. Large flat gradients band badly on a projector. */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-multiply"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
