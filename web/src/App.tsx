const panel =
  "rounded-[24px] border border-white/70 bg-white/55 backdrop-blur-xl backdrop-saturate-150 " +
  "shadow-[0_1px_2px_rgba(0,0,0,0.035),0_3px_8px_rgba(0,0,0,0.035),0_8px_28px_rgba(0,0,0,0.043)]";

export default function App() {
  return (
    <div className="relative min-h-full overflow-hidden">
      {/* The warm mesh ground. Frosted panels need something behind them worth blurring,
          which is the part light glassmorphism usually gets wrong. Colours are the poke.com
          palette pushed just far enough off paper to read through a 20px blur. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-paper">
        <div className="absolute -top-40 -left-32 h-[40rem] w-[40rem] rounded-full bg-[#F2C879] opacity-40 blur-[120px]" />
        <div className="absolute top-1/4 -right-40 h-[36rem] w-[36rem] rounded-full bg-[#9DBFA4] opacity-35 blur-[130px]" />
        <div className="absolute -bottom-48 left-1/4 h-[32rem] w-[32rem] rounded-full bg-[#E5A98C] opacity-30 blur-[140px]" />
      </div>

      <main className="mx-auto flex min-h-full max-w-[1200px] items-center px-10 py-16">
        <section className={`${panel} w-full max-w-[540px] p-[26px]`}>
          <p className="text-[14px] font-medium text-black/50">HackWesTX VII</p>
          <h1 className="mt-3 text-[52px] leading-[52px] font-semibold tracking-[-0.04em]">
            ParkTech
          </h1>
          <p className="mt-4 text-[16px] leading-[1.3] font-medium tracking-[-0.005em] text-black/70">
            A computer vision layer for parking infrastructure that already exists. Live stall
            availability from one ordinary fixed camera.
          </p>

          <div className="mt-6 border-t border-card-border pt-5">
            <p className="text-[13px] leading-[1.4] text-black/50">
              Scaffold only. The shell, the digital twin, click to route, and the analytics
              strip land in later changes. This page exists to prove the build works and to
              show the glass treatment on paper.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
