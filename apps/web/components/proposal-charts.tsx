import { formatPence } from "@goinstall/core";

// Validated pair (dataviz validator, light surface): with solar / without solar.
export const SERIES = { with: "#2a78d6", without: "#eb6834" } as const;
const GRID = "#e4e7ec";
const INK = "#475467";

/** Clean axis ticks from 0 (or below, for credits) to the max. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = Math.max(max - Math.min(0, min), 1);
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const lo = Math.min(0, Math.floor(min / step) * step);
  const out: number[] = [];
  for (let v = lo; v <= max + step * 0.999; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const compact = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}K` : String(Math.round(n)));
const money = (pence: number) => (Math.abs(pence) >= 100_000 ? `£${compact(pence / 100)}` : formatPence(Math.round(pence / 100) * 100));

/** Bars from a single baseline: one series, or two side by side. Values can go below zero (bill credits). */
export function BarChart({
  labels,
  series,
  format = (v) => compact(v),
  ariaLabel,
}: {
  labels: readonly string[];
  series: { name: string; color: string; values: readonly number[] }[];
  format?: (v: number) => string;
  ariaLabel: string;
}) {
  const W = 640;
  const H = 220;
  const pad = { l: 60, r: 8, t: 10, b: 24 };
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all, 1));
  const lo = ticks[0]!;
  const hi = ticks.at(-1)!;
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const band = (W - pad.l - pad.r) / labels.length;
  const barW = Math.min(24, (band - 8) / series.length - 2);
  const group = series.length * barW + (series.length - 1) * 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK}>
            {format(t)}
          </text>
        </g>
      ))}
      {labels.map((label, i) => {
        const x0 = pad.l + i * band + (band - group) / 2;
        return (
          <g key={label}>
            {series.map((s, j) => {
              const v = s.values[i] ?? 0;
              const top = y(Math.max(v, 0));
              const h = Math.max(1, Math.abs(y(v) - y(0)));
              const x = x0 + j * (barW + 2);
              const r = Math.min(4, barW / 2, h);
              // Rounded at the data end, square at the baseline.
              const d =
                v >= 0
                  ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`
                  : `M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + barW - r} Q${x + barW},${top + h} ${x + barW},${top + h - r} V${top} Z`;
              return (
                <path key={s.name} d={d} fill={s.color}>
                  <title>{`${label} · ${s.name}: ${format(v)}`}</title>
                </path>
              );
            })}
            <text x={pad.l + i * band + band / 2} y={H - 6} textAnchor="middle" fontSize={11} fill={INK}>
              {label}
            </text>
          </g>
        );
      })}
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#98a2b3" strokeWidth={1} />
    </svg>
  );
}

/** Lines over the years (e.g. annual bill with and without solar), end values labelled. */
export function LineChart({ years, series, ariaLabel }: { years: readonly number[]; series: { name: string; color: string; values: readonly number[] }[]; ariaLabel: string }) {
  const W = 640;
  const H = 220;
  const pad = { l: 56, r: 64, t: 12, b: 24 };
  const ticks = niceTicks(0, Math.max(...series.flatMap((s) => s.values), 1));
  const hi = ticks.at(-1)!;
  const x = (i: number) => pad.l + (i / Math.max(1, years.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((hi - v) / hi) * (H - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK}>
            {money(t)}
          </text>
        </g>
      ))}
      {years.map((yr, i) =>
        yr === 1 || yr % 5 === 0 ? (
          <text key={yr} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill={INK}>
            Year {yr}
          </text>
        ) : null,
      )}
      {series.map((s) => (
        <g key={s.name}>
          <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {s.values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={6} fill="transparent">
              <title>{`Year ${years[i]} · ${s.name}: ${money(v)}`}</title>
            </circle>
          ))}
          <circle cx={x(s.values.length - 1)} cy={y(s.values.at(-1)!)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
          <text x={x(s.values.length - 1) + 8} y={y(s.values.at(-1)!) + 4} fontSize={11} fill={INK}>
            {money(s.values.at(-1)!)}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-4 text-[13px] text-ink-3">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: i.color }} />
          {i.name}
        </li>
      ))}
    </ul>
  );
}
