import { useMemo } from "react";
import type { OccupancySeries } from "../../lib/analytics";

const W = 1000;
const H = 260;
const PAD = { top: 16, right: 12, bottom: 26, left: 34 };
/** The delta strip lives under the curve and shares its x axis. */
const STRIP = 46;

interface OccupancyChartProps {
  series: OccupancySeries;
}

function clock(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Occupancy over time, with the raw comings and goings underneath.
 *
 * Hand drawn rather than pulled from a chart library: this is one chart with one shape, and a
 * library would cost more bundle than the whole rest of the app while fighting the design
 * system for control of the colours.
 *
 * The two rows are deliberately both shown. The curve is what a person wants to know, how full
 * the lot was. The strip is what the database actually stores, the transitions, and it is the
 * continuous aggregate's own output rather than anything derived.
 */
export function OccupancyChart({ series }: OccupancyChartProps) {
  const { points, total, peak } = series;

  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom - STRIP;
    const t0 = points[0].time;
    const span = points[points.length - 1].time - t0 || 1;

    const x = (time: number) => PAD.left + ((time - t0) / span) * plotW;
    const y = (value: number) => PAD.top + plotH - (value / Math.max(1, total)) * plotH;

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.time).toFixed(1)} ${y(p.occupied).toFixed(1)}`).join(" ");
    const area = `${line} L ${x(points[points.length - 1].time).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} L ${x(t0).toFixed(1)} ${(PAD.top + plotH).toFixed(1)} Z`;

    const busiest = Math.max(1, ...points.map((p) => Math.max(p.arrivals, p.departures)));
    const stripMid = PAD.top + plotH + 22 + STRIP / 2;
    const barW = Math.max(1.2, (plotW / points.length) * 0.62);

    return { x, y, line, area, plotH, plotW, busiest, stripMid, barW, t0, span };
  }, [points, total]);

  if (!geometry) {
    return <p className="text-small text-ink/40">Not enough history yet to draw a curve.</p>;
  }

  const { x, y, line, area, plotH, busiest, stripMid, barW } = geometry;
  const ticks = [0, Math.round(total / 2), total];
  const labelEvery = Math.max(1, Math.floor(points.length / 5));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label={ariaFor(series)}>
      <defs>
        <linearGradient id="occupancy-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-taken-fill)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--color-taken-fill)" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {ticks.map((value) => (
        <g key={value}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(value)}
            y2={y(value)}
            stroke="var(--color-card-border)"
            strokeWidth={1}
          />
          <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end" fontSize={13} fill="rgb(0 0 0 / 0.35)">
            {value}
          </text>
        </g>
      ))}

      <path d={area} fill="url(#occupancy-fill)" />
      <path d={line} fill="none" stroke="var(--color-taken)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

      {peak && (
        <g>
          <circle cx={x(peak.time)} cy={y(peak.occupied)} r={5} fill="var(--color-taken)" stroke="var(--color-paper)" strokeWidth={2.5} />
          <text
            x={Math.min(x(peak.time) + 10, W - PAD.right - 90)}
            y={Math.max(y(peak.occupied) - 9, PAD.top + 11)}
            fontSize={14}
            fontWeight={600}
            fill="var(--color-taken)"
          >
            peak {peak.occupied} at {clock(peak.time)}
          </text>
        </g>
      )}

      {/* Comings and goings, straight off the continuous aggregate. Up is arrivals, down is
          departures, so a busy but balanced period is visibly different from a filling one. */}
      <line x1={PAD.left} x2={W - PAD.right} y1={stripMid} y2={stripMid} stroke="var(--color-card-border)" strokeWidth={1} />
      {points.map((p) => {
        const up = (p.arrivals / busiest) * (STRIP / 2 - 3);
        const down = (p.departures / busiest) * (STRIP / 2 - 3);
        return (
          <g key={p.t}>
            {p.arrivals > 0 && (
              <rect x={x(p.time) - barW / 2} y={stripMid - up} width={barW} height={up} fill="var(--color-taken-fill)" rx={0.8} />
            )}
            {p.departures > 0 && (
              <rect x={x(p.time) - barW / 2} y={stripMid} width={barW} height={down} fill="var(--color-open-edge)" rx={0.8} />
            )}
          </g>
        );
      })}

      {points.map((p, i) =>
        i % labelEvery === 0 || i === points.length - 1 ? (
          <text key={`t-${p.t}`} x={x(p.time)} y={H - 6} textAnchor="middle" fontSize={13} fill="rgb(0 0 0 / 0.35)">
            {clock(p.time)}
          </text>
        ) : null,
      )}

      <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="var(--color-muted-border)" strokeWidth={1} />
    </svg>
  );
}

function ariaFor(series: OccupancySeries): string {
  const { points, peak, total } = series;
  if (points.length === 0) return "No lot history yet";
  const from = clock(points[0].time);
  const to = clock(points[points.length - 1].time);
  const peakPart = peak ? ` Busiest was ${peak.occupied} of ${total} stalls at ${clock(peak.time)}.` : "";
  return `Occupancy from ${from} to ${to}, out of ${total} stalls.${peakPart}`;
}
