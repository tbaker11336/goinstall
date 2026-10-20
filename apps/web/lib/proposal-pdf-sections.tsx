import "server-only";
import { formatPence, MONTHS, paybackLabel, type ProposalSummary } from "@goinstall/core";
import { G, Image, Line, Page, Polyline, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";

// Same validated pair as the web charts. PDF text uses Helvetica (WinAnsi): no arrows, minus signs or subscripts.
const WITH = "#2a78d6";
const WITHOUT = "#eb6834";
const INK = "#101828";
const INK3 = "#475467";
const LINE = "#e4e7ec";
const cosd = (d: number) => Math.cos((d * Math.PI) / 180);
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
const kwh = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString("en-GB")} kWh`);

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: INK, fontFamily: "Helvetica" },
  h: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  muted: { color: INK3 },
  small: { fontSize: 8, color: INK3, lineHeight: 1.4 },
  stats: { flexDirection: "row", gap: 8, marginBottom: 8 },
  stat: { flex: 1, backgroundColor: "#f9fafb", borderRadius: 6, padding: 8 },
  statValue: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 3 },
  legend: { flexDirection: "row", gap: 12, marginBottom: 4 },
});

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.muted}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
      {sub && <Text style={s.small}>{sub}</Text>}
    </View>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <View style={s.legend}>
      {items.map(([name, color]) => (
        <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 7, height: 7, backgroundColor: color, borderRadius: 1 }} />
          <Text style={s.small}>{name}</Text>
        </View>
      ))}
    </View>
  );
}

function ticks(min: number, max: number) {
  const span = Math.max(max - Math.min(0, min), 1);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw)!;
  const lo = Math.min(0, Math.floor(min / step) * step);
  const out: number[] = [];
  for (let v = lo; v <= max + step * 0.999; v += step) out.push(v);
  return out;
}

function Bars({ series, format }: { series: { color: string; values: number[] }[]; format: (v: number) => string }) {
  const W = 515;
  const H = 150;
  const pad = { l: 40, r: 4, t: 6, b: 16 };
  const all = series.flatMap((x) => x.values);
  const t = ticks(Math.min(0, ...all), Math.max(...all, 1));
  const lo = t[0]!;
  const hi = t.at(-1)!;
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const band = (W - pad.l - pad.r) / 12;
  const bw = Math.min(14, (band - 6) / series.length - 2);
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {t.map((v) => (
        <G key={v}>
          <Line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={LINE} strokeWidth={0.6} />
          <Text x={pad.l - 4} y={y(v) + 3} style={{ fontSize: 7 }} fill={INK3} textAnchor="end">
            {format(v)}
          </Text>
        </G>
      ))}
      {MONTHS.map((m, i) => {
        const x0 = pad.l + i * band + (band - (series.length * (bw + 2) - 2)) / 2;
        return (
          <G key={m}>
            {series.map((x, j) => {
              const v = x.values[i] ?? 0;
              return <Rect key={j} x={x0 + j * (bw + 2)} y={y(Math.max(v, 0))} width={bw} height={Math.max(0.6, Math.abs(y(v) - y(0)))} fill={x.color} />;
            })}
            <Text x={pad.l + i * band + band / 2} y={H - 4} style={{ fontSize: 7 }} fill={INK3} textAnchor="middle">
              {m}
            </Text>
          </G>
        );
      })}
      <Line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#98a2b3" strokeWidth={0.8} />
    </Svg>
  );
}

function Lines({ series }: { series: { color: string; values: number[] }[] }) {
  const W = 515;
  const H = 150;
  const pad = { l: 44, r: 22, t: 6, b: 16 };
  const t = ticks(0, Math.max(...series.flatMap((x) => x.values), 1));
  const hi = t.at(-1)!;
  const n = series[0]!.values.length;
  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((hi - v) / hi) * (H - pad.t - pad.b);
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {t.map((v) => (
        <G key={v}>
          <Line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={LINE} strokeWidth={0.6} />
          <Text x={pad.l - 4} y={y(v) + 3} style={{ fontSize: 7 }} fill={INK3} textAnchor="end">
            {`£${Math.round(v / 100).toLocaleString("en-GB")}`}
          </Text>
        </G>
      ))}
      {Array.from({ length: n }, (_, i) =>
        i === 0 || (i + 1) % 5 === 0 ? (
          <Text key={i} x={x(i)} y={H - 4} style={{ fontSize: 7 }} fill={INK3} textAnchor="middle">
            {`Year ${i + 1}`}
          </Text>
        ) : null,
      )}
      {series.map((sr, k) => (
        <Polyline key={k} points={sr.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} stroke={sr.color} strokeWidth={1.5} fill="none" />
      ))}
    </Svg>
  );
}

/** Extra pages for a solar proposal: layout, bills, 20-year figures, system, MCS, environment, assumptions. */
export function ProposalPdfSections({ sm, layoutSrc, footer }: { sm: ProposalSummary; layoutSrc: string | null; footer: React.ReactNode }) {
  const f = sm.finance;
  const d = sm.details;
  const pages: React.ReactNode[] = [];

  if (sm.layout && layoutSrc) {
    const L = sm.layout;
    const box = 515;
    // The saved tile is cropped to its middle half, where the roof is.
    const view = L.widthM / 2;
    pages.push(
      <Page key="layout" size="A4" style={s.page}>
        <Text style={s.h}>Proposed panel layout</Text>
        <View style={{ width: box, height: box, overflow: "hidden", borderRadius: 6, position: "relative" }}>
          <Image src={layoutSrc} style={{ position: "absolute", left: -box / 2, top: -box / 2, width: box * 2, height: box * 2 }} />
          <Svg width={box} height={box} viewBox={`${-view / 2} ${-view / 2} ${view} ${view}`} style={{ position: "absolute", left: 0, top: 0 }}>
            {L.segments.map((sg, i) => (
              <G key={i} transform={`translate(${sg.origin.x} ${sg.origin.y}) rotate(${sg.azimuth - 180}) translate(${-sg.width / 2} ${(-sg.depth * cosd(sg.pitch)) / 2}) scale(1 ${cosd(sg.pitch)})`}>
                {sg.panels.map((p, j) => (
                  <Rect key={j} x={p.x} y={p.y} width={p.w} height={p.h} fill="#1e2a3e" stroke="#c7d2e0" strokeWidth={0.03} />
                ))}
              </G>
            ))}
          </Svg>
        </View>
        {d?.imageryDate && <Text style={[s.small, { marginTop: 6 }]}>Aerial imagery {new Date(d.imageryDate).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}. The final layout may change after the site survey.</Text>}
        {footer}
      </Page>,
    );
  }

  if (f) {
    const t = f.firstYear.totals;
    const cf = f.cashFlow;
    const years = cf.rows.slice(1);
    pages.push(
      <Page key="bills" size="A4" style={s.page}>
        <Text style={s.h}>Your electricity bills</Text>
        <View style={s.stats}>
          <Stat label="Average monthly bill now" value={formatPence(Math.round(t.billBeforePence / 12))} sub={`${formatPence(t.billBeforePence)} a year`} />
          <Stat label="With solar, first year" value={formatPence(Math.round(t.billAfterPence / 12))} sub={`${formatPence(t.billAfterPence)} a year · down ${pct(t.savingPct)}`} />
          <Stat label="Saving in year one" value={formatPence(t.savingPence)} />
        </View>
        <View style={s.stats}>
          <Stat label="Solar used at home" value={pct(t.selfConsumption)} />
          <Stat label="Your use met by solar" value={pct(t.selfSufficiency)} />
          <Stat label="Sent to the grid" value={kwh(t.exportKwh)} />
        </View>
        <Text style={s.h2}>Monthly bill, with and without solar</Text>
        <Legend items={[["Without solar", WITHOUT], ["With solar", WITH]]} />
        <Bars series={[{ color: WITHOUT, values: f.firstYear.billBeforePence.map((p) => p / 100) }, { color: WITH, values: f.firstYear.billAfterPence.map((p) => p / 100) }]} format={(v) => `£${Math.round(v)}`} />
        <Text style={s.small}>Below zero is a credit: export payments are more than the bill that month.</Text>
        <Text style={s.h2}>Average daily generation by month</Text>
        <Bars series={[{ color: WITH, values: f.firstYear.generation.map((g, i) => g / [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i]!) }]} format={(v) => `${v.toFixed(0)} kWh`} />
        <Text style={s.small}>The MCS method gives an annual figure only; months follow {d?.pvgisMonthly ? "PVGIS's monthly pattern for your location" : "the length of each month"}.</Text>
        {footer}
      </Page>,
      <Page key="finance" size="A4" style={s.page}>
        <Text style={s.h}>{sm.assumptions?.lifetimeYears ?? 20}-year financial summary</Text>
        <View style={s.stats}>
          <Stat label="Net present value" value={formatPence(cf.npvPence)} sub="Today's value of future savings, minus the cost" />
          <Stat label="Discounted payback" value={paybackLabel(cf.discountedPaybackYears)} sub={cf.simplePaybackYears ? `Simple payback ${cf.simplePaybackYears} years` : undefined} />
          <Stat label="Internal rate of return" value={cf.irr === null ? "—" : `${(cf.irr * 100).toFixed(1)}%`} />
        </View>
        <Text style={s.h2}>Annual bill</Text>
        <Legend items={[["Without solar", WITHOUT], ["With solar", WITH]]} />
        <Lines series={[{ color: WITHOUT, values: years.map((r) => r.billWithoutPence) }, { color: WITH, values: years.map((r) => Math.max(0, r.billWithPence)) }]} />
        <Text style={s.h2}>Savings cash flow</Text>
        <View style={[s.row, { borderBottomColor: "#d0d5dd" }]}>
          {["Year", "Generation (kWh)", "Used at home", "Export", "Costs", "Total", "Cumulative"].map((h, i) => (
            <Text key={h} style={{ flex: i === 0 ? 0.5 : 1, textAlign: i === 0 ? "left" : "right", fontSize: 7, fontFamily: "Helvetica-Bold", color: INK3 }}>
              {h}
            </Text>
          ))}
        </View>
        {cf.rows.map((r) => (
          <View key={r.year} style={[s.row, { paddingVertical: 2 }]}>
            {[String(r.year), r.generationKwh.toLocaleString("en-GB"), formatPence(r.selfUseValuePence), formatPence(r.exportValuePence), formatPence(r.expensesPence), formatPence(r.totalPence), formatPence(r.cumulativePence)].map((c, i) => (
              <Text key={i} style={{ flex: i === 0 ? 0.5 : 1, textAlign: i === 0 ? "left" : "right", fontSize: 7.5, color: i === 6 && r.cumulativePence < 0 ? "#b42318" : INK }}>
                {c}
              </Text>
            ))}
          </View>
        ))}
        <Text style={[s.small, { marginTop: 4 }]}>Includes electricity price rises and the value of money over time, so it differs from the first-year saving.</Text>
        {footer}
      </Page>,
    );
  }

  if (d) {
    const kv = (k: string, v: string) => (
      <View key={k} style={s.row}>
        <Text style={{ flex: 2, color: INK3 }}>{k}</Text>
        <Text style={{ flex: 1, textAlign: "right" }}>{v}</Text>
      </View>
    );
    const warranties = d.products.filter((p) => p.specs.warranty_years || p.specs.performance_warranty_years);
    pages.push(
      <Page key="mcs" size="A4" style={s.page}>
        <Text style={s.h}>System details</Text>
        {kv("Solar system size", sm.kWp ? `${sm.kWp.toFixed(2)} kWp` : "—")}
        {kv("Estimated annual generation (MCS)", kwh(sm.annualKwh))}
        {d.products.map((p) => kv({ panel: "Solar panels", inverter: "Inverter", battery: "Battery storage", ev_charger: "EV charger", mounting: "Mounting" }[p.role], `${p.count > 1 ? `${p.count} × ` : ""}${[p.make, p.name].filter(Boolean).join(" ")}`))}
        {warranties.length > 0 && (
          <>
            <Text style={s.h2}>Warranty</Text>
            {warranties.map((p) => kv([p.make, p.model].filter(Boolean).join(" "), [p.specs.warranty_years && `${p.specs.warranty_years} yrs product`, p.specs.performance_warranty_years && `${p.specs.performance_warranty_years} yrs performance`].filter(Boolean).join(", ")))}
          </>
        )}
        {d.arrays.length > 0 && sm.annualKwh && (
          <>
            <Text style={s.h2}>MCS performance estimate</Text>
            {kv("Installed capacity — kWp (STC)", d.arrays.map((a) => a.kWp.toFixed(3)).join(" · "))}
            {kv("Orientation — degrees from south", d.arrays.map((a) => `${Math.abs(Math.round(((a.azimuth - 180 + 540) % 360) - 180))}°`).join(" · "))}
            {kv("Inclination — degrees from horizontal", d.arrays.map((a) => `${Math.round(a.pitch)}°`).join(" · "))}
            {kv("Postcode region", d.zone ?? "—")}
            {kv("kWh/kWp (Kk) from table", d.arrays.map((a) => a.kwhPerKwp ?? "—").join(" · "))}
            {kv("Shade factor (SF)", d.arrays.map((a) => a.shadeFactor).join(" · "))}
            {kv("Total estimated annual output (kWp × Kk × SF)", kwh(sm.annualKwh))}
            {kv("Assumed annual electricity consumption", kwh(sm.energy?.annualKwh))}
            {d.selfUsePvOnly !== null && kv("Expected self-consumption (PV only)", kwh(sm.annualKwh * d.selfUsePvOnly))}
            {d.selfUseWithBattery !== null && kv("Expected self-consumption (with battery)", kwh(sm.annualKwh * d.selfUseWithBattery))}
            {d.batteryUsableKwh && kv("Usable battery capacity", `${d.batteryUsableKwh} kWh`)}
            <Text style={[s.small, { marginTop: 8 }]}>
              Important note: The performance of solar PV systems is impossible to predict with certainty due to the variability in the amount of solar radiation (sunlight) from location to
              location and from year to year. This estimate is based upon the standard MCS procedure and is given as guidance only for the first year of generation. It should not be
              considered as a guarantee of performance. The solar PV self-consumption has been calculated in accordance with the most relevant methodology for your system; external
              factors can have a significant effect on it, so it should not be considered as a guarantee.
              {d.selfUseWithBattery !== null
                ? " The energy performance and benefits of battery storage are impossible to predict with certainty due to the numerous functions a system can be programmed to perform; this estimate is given as guidance only."
                : ""}
            </Text>
            {d.googleKwh && <Text style={s.small}>Cross-check: Google&apos;s Solar API estimates {kwh(d.googleKwh)} (DC) for this layout.</Text>}
          </>
        )}
        {f?.co2KgPerYear != null && (
          <>
            <Text style={s.h2}>Environmental benefits</Text>
            {kv("CO2 avoided in year one", `${f.co2KgPerYear.toLocaleString("en-GB")} kg`)}
            {sm.emissions?.source && <Text style={s.small}>Grid emissions factor {sm.emissions.kgPerKwh} kg CO2/kWh: {sm.emissions.source}.</Text>}
          </>
        )}
        {sm.assumptions && f && (
          <>
            <Text style={s.h2}>Assumed values</Text>
            {kv("Electricity use", kwh(sm.energy?.annualKwh))}
            {sm.energy?.tariff && kv("Unit rate · standing charge · export", `${sm.energy.tariff.unitRatePence}p/kWh · ${sm.energy.tariff.standingChargePencePerDay}p/day · ${sm.energy.tariff.exportRatePence}p/kWh`)}
            {kv("Electricity price inflation", `${sm.assumptions.electricityInflationPct}% a year`)}
            {kv("Discount rate", `${sm.assumptions.discountRatePct}% a year`)}
            {kv("System lifetime", `${sm.assumptions.lifetimeYears} years`)}
            {kv("Panel degradation", `${100 - sm.assumptions.degradationFirstYearPct}% in year 1, then -${sm.assumptions.degradationAnnualPct}% a year`)}
            <Text style={[s.small, { marginTop: 4 }]}>
              Savings are estimates based on the electricity use and tariff above. Actual generation and savings will vary with the weather, how energy is used, and future prices and
              tariffs.
            </Text>
          </>
        )}
        {footer}
      </Page>,
    );
  }
  return <>{pages}</>;
}

