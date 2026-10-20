import { formatPence, MONTHS, paybackLabel, spreadByMonth, type LayoutSnapshot, type ProposalSummary } from "@goinstall/core";
import { BarChart, Legend, LineChart, SERIES } from "./proposal-charts";

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const kwh = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString("en-GB")} kWh`);
const cosd = (d: number) => Math.cos((d * Math.PI) / 180);
const facing = (az: number) => {
  const fromSouth = ((az - 180 + 540) % 360) - 180;
  return `${Math.abs(Math.round(fromSouth))}°${fromSouth === 0 ? "" : fromSouth > 0 ? " W" : " E"}`;
};

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t pt-6">
      <div>
        <h3 id={id} className="text-lg font-bold">
          {title}
        </h3>
        {intro && <p className="text-sm text-ink-3">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[10px] bg-surface-subtle p-4">
      <span className="text-[13px] text-ink-3">{label}</span>
      <span className="text-xl font-bold tracking-[-0.01em]" data-testid={testId}>
        {value}
      </span>
      {sub && <span className="text-xs text-ink-3">{sub}</span>}
    </div>
  );
}

/** The designed panels on the aerial image saved with the proposal. */
export function LayoutImage({ layout, url, label }: { layout: LayoutSnapshot; url: string; label: string }) {
  const W = layout.widthM;
  // Crop to the roof area: half the tile around the site centre.
  const view = W / 2;
  return (
    <svg viewBox={`${-view / 2} ${-view / 2} ${view} ${view}`} className="aspect-square w-full rounded-[10px]" role="img" aria-label={label}>
      <image href={url} x={-W / 2} y={-W / 2} width={W} height={W} preserveAspectRatio="none" />
      {layout.segments.map((s, i) => (
        <g key={i} transform={`translate(${s.origin.x} ${s.origin.y}) rotate(${s.azimuth - 180}) translate(${-s.width / 2} ${(-s.depth * cosd(s.pitch)) / 2}) scale(1 ${cosd(s.pitch)})`}>
          {s.panels.map((p, j) => (
            <rect key={j} x={p.x} y={p.y} width={p.w} height={p.h} fill="#1e2a3e" stroke="#c7d2e0" strokeWidth={0.03} />
          ))}
        </g>
      ))}
    </svg>
  );
}

export function BillsSection({ s }: { s: ProposalSummary }) {
  const f = s.finance;
  if (!f) return null;
  const t = f.firstYear.totals;
  return (
    <Section id="sec-bills" title="Your electricity bills" intro={`From ${s.energy?.source === "bills" ? "your bills" : "your estimated use"}${s.energy?.tariffName ? ` on ${s.energy.tariffName}` : ""}: ${kwh(t.consumptionKwh)} a year.`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Average monthly bill now" value={formatPence(Math.round(t.billBeforePence / 12))} />
          <Stat label="Annual bill now" value={formatPence(t.billBeforePence)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="With solar, first year" value={formatPence(Math.round(t.billAfterPence / 12))} sub={`↓ ${pct(t.savingPct)} a month on average`} testId="bill-after-monthly" />
          <Stat label="Saving in year one" value={formatPence(t.savingPence)} sub={`${formatPence(t.billAfterPence)} a year`} testId="first-year-saving" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Solar used at home" value={pct(t.selfConsumption)} />
        <Stat label="Your use met by solar" value={pct(t.selfSufficiency)} />
        <Stat label="Sent to the grid" value={kwh(t.exportKwh)} />
      </div>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm font-semibold">Monthly bill, with and without solar</figcaption>
        <Legend
          items={[
            { name: "Without solar", color: SERIES.without },
            { name: "With solar", color: SERIES.with },
          ]}
        />
        <BarChart
          labels={MONTHS}
          series={[
            { name: "Without solar", color: SERIES.without, values: f.firstYear.billBeforePence.map((p) => p / 100) },
            { name: "With solar", color: SERIES.with, values: f.firstYear.billAfterPence.map((p) => p / 100) },
          ]}
          format={(v) => `£${Math.round(v)}`}
          ariaLabel="Monthly bill with and without solar"
        />
        <p className="text-xs text-muted-foreground">Below zero is a credit: export payments are more than the bill that month.</p>
      </figure>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm font-semibold">Average daily generation by month</figcaption>
        <BarChart
          labels={MONTHS}
          series={[{ name: "Generation", color: SERIES.with, values: f.firstYear.generation.map((g, i) => g / [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i]!) }]}
          format={(v) => `${v === 0 ? 0 : v.toFixed(v < 10 ? 1 : 0)} kWh`}
          ariaLabel="Average daily generation by month"
        />
        <p className="text-xs text-muted-foreground">
          The MCS method gives an annual figure only; months follow {s.details?.pvgisMonthly ? "PVGIS's monthly pattern for your location" : "the length of each month"}.
        </p>
      </figure>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Month by month table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-right">
            <thead className="text-xs text-ink-3">
              <tr>
                <th className="py-1 text-left font-semibold">Month</th>
                <th className="font-semibold">Use</th>
                <th className="font-semibold">Generation</th>
                <th className="font-semibold">Bill now</th>
                <th className="font-semibold">With solar</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((m, i) => (
                <tr key={m} className="border-t">
                  <td className="py-1 text-left">{m}</td>
                  <td>{kwh(f.firstYear.consumption[i])}</td>
                  <td>{kwh(f.firstYear.generation[i])}</td>
                  <td>{formatPence(f.firstYear.billBeforePence[i])}</td>
                  <td>{formatPence(f.firstYear.billAfterPence[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Section>
  );
}

export function FinanceSection({ s }: { s: ProposalSummary }) {
  const cf = s.finance?.cashFlow;
  if (!cf || !s.assumptions) return null;
  const years = cf.rows.slice(1);
  return (
    <Section id="sec-finance" title={`${s.assumptions.lifetimeYears}-year financial summary`} intro="Includes electricity price rises and the value of money over time, so it differs from the first-year saving.">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Net present value" value={formatPence(cf.npvPence)} sub="Today's value of all future savings, minus the cost" testId="npv" />
        <Stat label="Discounted payback" value={paybackLabel(cf.discountedPaybackYears)} sub={cf.simplePaybackYears ? `Simple payback ${cf.simplePaybackYears} years` : undefined} testId="payback" />
        <Stat label="Internal rate of return" value={cf.irr === null ? "—" : `${(cf.irr * 100).toFixed(1)}%`} sub="The higher, the better" testId="irr" />
      </div>
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm font-semibold">Annual bill</figcaption>
        <Legend
          items={[
            { name: "Without solar", color: SERIES.without },
            { name: "With solar", color: SERIES.with },
          ]}
        />
        <LineChart
          years={years.map((r) => r.year)}
          series={[
            { name: "Without solar", color: SERIES.without, values: years.map((r) => r.billWithoutPence) },
            { name: "With solar", color: SERIES.with, values: years.map((r) => Math.max(0, r.billWithPence)) },
          ]}
          ariaLabel="Annual bill with and without solar over the years"
        />
      </figure>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Savings cash flow, year by year</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-right" data-testid="cash-flow">
            <thead className="text-xs text-ink-3">
              <tr>
                <th className="py-1 text-left font-semibold">Year</th>
                <th className="font-semibold">Generation</th>
                <th className="font-semibold">Used at home</th>
                <th className="font-semibold">Export</th>
                <th className="font-semibold">Costs</th>
                <th className="font-semibold">Total</th>
                <th className="font-semibold">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {cf.rows.map((r) => (
                <tr key={r.year} className="border-t">
                  <td className="py-1 text-left">{r.year}</td>
                  <td>{r.generationKwh.toLocaleString("en-GB")}</td>
                  <td>{formatPence(r.selfUseValuePence)}</td>
                  <td>{formatPence(r.exportValuePence)}</td>
                  <td>{formatPence(r.expensesPence)}</td>
                  <td>{formatPence(r.totalPence)}</td>
                  <td className={r.cumulativePence < 0 ? "text-red-700" : undefined}>{formatPence(r.cumulativePence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Section>
  );
}

const ROLE_LABEL = { panel: "Solar panels", inverter: "Inverter", battery: "Battery storage", ev_charger: "EV charger", mounting: "Mounting" } as const;

export function SystemSection({ s }: { s: ProposalSummary }) {
  const d = s.details;
  if (!d) return null;
  const spec = (p: (typeof d.products)[number]) => {
    const x = p.specs;
    const parts: string[] = [];
    if (p.role === "panel") parts.push(...[x.watts_peak && `${x.watts_peak} W`, x.width_mm && x.height_mm && `${x.height_mm} × ${x.width_mm} mm`].filter(Boolean).map(String));
    if (p.role === "inverter") parts.push(...[x.ac_kw && `${x.ac_kw} kW`, x.phases && (Number(x.phases) === 3 ? "three phase" : "single phase"), x.efficiency_pct && `${x.efficiency_pct}% max efficiency`].filter(Boolean).map(String));
    if (p.role === "battery") parts.push(...[x.capacity_kwh && `${x.capacity_kwh} kWh`, x.usable_kwh && `${x.usable_kwh} kWh usable`].filter(Boolean).map(String));
    if (p.role === "ev_charger") parts.push(...[x.rated_kw && `${x.rated_kw} kW`, x.tethered === true ? "tethered" : x.tethered === false ? "socket" : null].filter(Boolean).map(String));
    return parts.join(" · ");
  };
  const warranties = d.products.filter((p) => p.specs.warranty_years || p.specs.performance_warranty_years);
  return (
    <Section id="sec-system" title="System details">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-[13px] text-ink-3">Solar system size</dt>
          <dd className="font-semibold">{s.kWp ? `${s.kWp.toFixed(2)} kWp` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-3">Estimated annual generation (MCS)</dt>
          <dd className="font-semibold">{kwh(s.annualKwh)}</dd>
        </div>
        {d.products.map((p) => (
          <div key={p.role}>
            <dt className="text-[13px] text-ink-3">{ROLE_LABEL[p.role]}</dt>
            <dd className="font-semibold">
              {p.count > 1 ? `${p.count} × ` : ""}
              {[p.make, p.name].filter(Boolean).join(" ")}
            </dd>
            {spec(p) && <dd className="text-xs text-ink-3">{spec(p)}</dd>}
          </div>
        ))}
      </dl>
      {warranties.length > 0 && (
        <table className="w-full text-sm">
          <caption className="mb-1 text-left text-sm font-semibold">Warranty</caption>
          <thead className="text-xs text-ink-3">
            <tr className="text-left">
              <th className="py-1 font-semibold">Product</th>
              <th className="font-semibold">Type</th>
              <th className="font-semibold">Warranty</th>
            </tr>
          </thead>
          <tbody>
            {warranties.map((p) => (
              <tr key={p.role} className="border-t">
                <td className="py-1.5">{[p.make, p.model].filter(Boolean).join(" ")}</td>
                <td>{ROLE_LABEL[p.role]}</td>
                <td>{[p.specs.warranty_years && `${p.specs.warranty_years} years product`, p.specs.performance_warranty_years && `${p.specs.performance_warranty_years} years performance`].filter(Boolean).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function McsSection({ s }: { s: ProposalSummary }) {
  const d = s.details;
  if (!d || !d.arrays.length || !s.annualKwh) return null;
  const cons = s.energy?.annualKwh ?? null;
  const row = (label: string, ...cells: React.ReactNode[]) => (
    <tr className="border-t">
      <th scope="row" className="py-1.5 text-left font-normal text-ink-2">
        {label}
      </th>
      {cells.map((c, i) => (
        <td key={i} className="text-right">
          {c}
        </td>
      ))}
    </tr>
  );
  const pad = (n: number) => Array.from({ length: Math.max(0, d.arrays.length - n) }, () => "");
  return (
    <Section id="sec-mcs" title="MCS performance estimate">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <tbody>
            <tr>
              <th colSpan={d.arrays.length + 1} className="pb-1 text-left text-sm font-bold">
                Installation data
              </th>
            </tr>
            {row("Installed capacity of PV system — kWp (STC)", ...d.arrays.map((a) => a.kWp.toFixed(3)))}
            {row("Orientation of PV — degrees from south", ...d.arrays.map((a) => facing(a.azimuth)))}
            {row("Inclination — degrees from horizontal", ...d.arrays.map((a) => `${Math.round(a.pitch)}°`))}
            {row("Postcode region", ...pad(1), d.zone ?? "—")}
            <tr>
              <th colSpan={d.arrays.length + 1} className="pt-4 pb-1 text-left text-sm font-bold">
                Performance calculations
              </th>
            </tr>
            {row("kWh/kWp (Kk) from table", ...d.arrays.map((a) => a.kwhPerKwp ?? "—"))}
            {row("Shade factor (SF)", ...d.arrays.map((a) => a.shadeFactor))}
            {row("Total estimated annual output (kWp × Kk × SF)", ...pad(1), kwh(s.annualKwh))}
            <tr>
              <th colSpan={d.arrays.length + 1} className="pt-4 pb-1 text-left text-sm font-bold">
                Estimated PV self-consumption
              </th>
            </tr>
            {row("Assumed annual electricity consumption", ...pad(1), kwh(cons))}
            {row("Expected solar PV self-consumption (PV only)", ...pad(1), d.selfUsePvOnly === null ? "—" : kwh(s.annualKwh * d.selfUsePvOnly))}
            {row("Grid independence / self-sufficiency (PV only)", ...pad(1), d.selfUsePvOnly !== null && cons ? pct(Math.min(1, (s.annualKwh * d.selfUsePvOnly) / cons)) : "—")}
            {d.selfUseWithBattery !== null && (
              <>
                {row("Usable battery capacity used for self-consumption", ...pad(1), d.batteryUsableKwh ? `${d.batteryUsableKwh} kWh` : "—")}
                {row("Expected solar PV self-consumption (with battery)", ...pad(1), kwh(s.annualKwh * d.selfUseWithBattery))}
                {row("Grid independence / self-sufficiency (with battery)", ...pad(1), cons ? pct(Math.min(1, (s.annualKwh * d.selfUseWithBattery) / cons)) : "—")}
              </>
            )}
          </tbody>
        </table>
      </div>
      {(d.googleKwh || d.imageryDate) && (
        <p className="text-xs text-muted-foreground">
          {d.googleKwh ? `Cross-check: Google's Solar API estimates ${kwh(d.googleKwh)} (DC) for this layout. ` : ""}
          {d.imageryDate ? `Aerial imagery dated ${new Date(d.imageryDate).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}.` : ""}
        </p>
      )}
      <div className="flex flex-col gap-2 rounded-[10px] bg-surface-subtle p-4 text-xs text-ink-3">
        <p>
          <strong className="text-foreground">Important note:</strong> The performance of solar PV systems is impossible to predict with certainty due to the variability in the amount of
          solar radiation (sunlight) from location to location and from year to year. This estimate is based upon the standard MCS procedure and is given as guidance only for the first
          year of generation. It should not be considered as a guarantee of performance.
        </p>
        <p>
          The solar PV self-consumption has been calculated in accordance with the most relevant methodology for your system. There are a number of external factors that can have a
          significant effect on the amount of energy that is self-consumed, so this figure should not be considered as a guarantee of the amount of energy that will be self-consumed.
        </p>
        {d.selfUseWithBattery !== null && (
          <p>
            <strong className="text-foreground">Important note:</strong> The energy performance and benefits of battery storage are impossible to predict with certainty due to the numerous
            functions a system can be programmed to perform. This estimate is based upon the standard MCS procedure and is given as guidance only. It should not be considered as a guarantee
            of performance.
          </p>
        )}
      </div>
    </Section>
  );
}

export function EnvironmentSection({ s }: { s: ProposalSummary }) {
  const co2 = s.finance?.co2KgPerYear;
  if (co2 === null || co2 === undefined || !s.assumptions) return null;
  const lifetime = s.finance!.cashFlow.rows.slice(1).reduce((n, r) => n + r.generationKwh, 0) * (s.emissions?.kgPerKwh ?? 0);
  return (
    <Section id="sec-env" title="Environmental benefits" intro="From the electricity your panels generate instead of the grid.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="CO₂ avoided in year one" value={`${co2.toLocaleString("en-GB")} kg`} />
        <Stat label={`CO₂ avoided over ${s.assumptions.lifetimeYears} years`} value={`${(Math.round(lifetime / 100) / 10).toLocaleString("en-GB")} tonnes`} />
      </div>
      {s.emissions?.source && <p className="text-xs text-muted-foreground">Grid emissions factor {s.emissions.kgPerKwh} kg CO₂/kWh: {s.emissions.source}.</p>}
    </Section>
  );
}

export function AssumptionsSection({ s }: { s: ProposalSummary }) {
  const a = s.assumptions;
  const t = s.energy?.tariff;
  if (!a || !s.finance) return null;
  const items: [string, string][] = [
    ["Electricity use", s.energy?.monthlyKwh ? `${kwh(s.energy.annualKwh)} a year (monthly figures given)` : kwh(s.energy?.annualKwh)],
    ["Unit rate", t ? `${t.unitRatePence}p per kWh` : "—"],
    ["Standing charge", t ? `${t.standingChargePencePerDay}p per day` : "—"],
    ["Export tariff", t ? `${t.exportRatePence}p per kWh` : "—"],
    ["Electricity price inflation", `${a.electricityInflationPct}% a year`],
    ["Discount rate", `${a.discountRatePct}% a year`],
    ["System lifetime", `${a.lifetimeYears} years`],
    ["Panel degradation", `${100 - a.degradationFirstYearPct}% output in year 1, then −${a.degradationAnnualPct}% a year`],
    ["Self-consumption", pct(s.selfUse)],
  ];
  return (
    <Section id="sec-assumptions" title="Assumed values">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {items.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b py-1.5">
            <dt className="text-ink-3">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Estimated savings are based on the electricity use and tariff above. Actual generation and savings will vary with the weather, how you use energy, and future prices and tariffs,
        which this proposal can&apos;t control.
      </p>
    </Section>
  );
}

/** Monthly generation split from an annual figure (used by the PDF too). */
export const monthlyFromSummary = (s: ProposalSummary) => (s.annualKwh ? spreadByMonth(s.annualKwh, s.details?.pvgisMonthly) : null);
