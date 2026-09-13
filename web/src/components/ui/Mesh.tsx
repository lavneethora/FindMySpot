/**
 * The warm mesh ground. Purely decorative, and the reason the frosted panels have anything
 * to blur. Fixed rather than scrolled, so the blooms do not slide under the panels.
 */
export function Mesh() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-ground">
      <div className="absolute -top-40 -left-32 h-[40rem] w-[40rem] rounded-full bg-bloom-amber opacity-40 blur-[120px]" />
      <div className="absolute top-1/4 -right-40 h-[36rem] w-[36rem] rounded-full bg-bloom-sage opacity-35 blur-[130px]" />
      {/* Sits behind the header pills, top right, which was bare cream before. Glass can only
          show you what is behind it, so with nothing there the refraction had nothing to bend
          and the pills read as flat. Low opacity: this is there to be distorted, not seen. */}
      <div className="absolute -top-56 right-[-6rem] h-[34rem] w-[34rem] rounded-full bg-bloom-clay opacity-30 blur-[110px]" />
      <div className="absolute -bottom-48 left-1/4 h-[32rem] w-[32rem] rounded-full bg-bloom-clay opacity-30 blur-[140px]" />
      {/* Real grain, not generated. feTurbulence stood in here before and looked like static
          rather than paper: it is uniform noise, where a scanned grain has clumps and grain
          direction. It also costs the compositor real time to regenerate across a large
          viewport, which a tiled PNG does not.

          The file is baked very faint, average alpha around 0.07, so 0.6 opacity is doing
          real work rather than being a light touch. Tiled at 90px: large enough that the
          repeat is not visible, small enough that the texture reads at arm's length. */}
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: 'url("/bgNoise.png")',
          backgroundRepeat: "repeat",
          backgroundSize: "90px 90px",
        }}
      />
    </div>
  );
}
