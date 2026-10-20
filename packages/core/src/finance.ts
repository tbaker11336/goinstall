/**
 * Customer finance for a solar (and battery) proposal: bills before and
 * after, first-year savings, and a 20-year cash flow with NPV, IRR and
 * discounted payback. Money is integer pence; energy is kWh.
 *
 * Generation is the MCS annual figure; months follow the PVGIS monthly
 * shape (MCS gives no monthly method). Self-consumption is the MCS
 * fraction. Financial assumptions are company settings (defaults below are
 * the business's own, from its October 2026 example proposal).
 */

export interface Tariff {
  unitRatePence: number;
  standingChargePencePerDay: number;
  exportRatePence: number;
}

export interface FinanceAssumptions {
  /** Yearly rise in electricity prices, %. */
  electricityInflationPct: number;
  /** Discount rate for NPV and discounted payback, %. */
  discountRatePct: number;
  lifetimeYears: number;
  /** Output lost in year 1, % (panel datasheet if given). */
  degradationFirstYearPct: number;
  /** Output lost each later year, %. */
  degradationAnnualPct: number;
}

export const DEFAULT_FINANCE: FinanceAssumptions = {
  electricityInflationPct: 5,
  discountRatePct: 2.58,
  lifetimeYears: 20,
  degradationFirstYearPct: 2,
  degradationAnnualPct: 0.55,
};

export const FINANCE_FIELDS: { key: keyof FinanceAssumptions; label: string; unit: string; min: number; max: number; help: string }[] = [
  { key: "electricityInflationPct", label: "Electricity price inflation", unit: "% a year", min: 0, max: 30, help: "How fast electricity prices are assumed to rise." },
  { key: "discountRatePct", label: "Discount (interest) rate", unit: "% a year", min: 0, max: 30, help: "Used for net present value and discounted payback." },
  { key: "lifetimeYears", label: "System lifetime", unit: "years", min: 5, max: 40, help: "Years shown in the cash flow." },
  { key: "degradationFirstYearPct", label: "Panel output lost in year 1", unit: "%", min: 0, max: 10, help: "Used when a panel's datasheet value isn't entered." },
  { key: "degradationAnnualPct", label: "Panel output lost each later year", unit: "%", min: 0, max: 5, help: "Used when a panel's datasheet value isn't entered." },
];

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const sum = (a: readonly number[]) => a.reduce((n, x) => n + x, 0);

/** Annual figure → months, in proportion to a monthly shape (e.g. PVGIS), or to days in the month. */
export function spreadByMonth(annual: number, shape?: readonly number[] | null): number[] {
  const w = shape && shape.length === 12 && sum(shape) > 0 ? shape : DAYS;
  const total = sum(w);
  return w.map((x) => (annual * x) / total);
}

/** Monthly consumption from what the customer gave: 12 monthly figures, or an annual one. */
export function monthlyConsumption(input: { annualKwh?: number | null; monthlyKwh?: readonly (number | null)[] | null }): number[] | null {
  const m = input.monthlyKwh;
  if (m && m.length === 12 && m.every((x) => typeof x === "number" && x >= 0)) return m as number[];
  if (input.annualKwh && input.annualKwh > 0) return spreadByMonth(input.annualKwh);
  return null;
}

export interface FirstYear {
  generation: number[];
  consumption: number[];
  selfUse: number[];
  exported: number[];
  billBeforePence: number[];
  billAfterPence: number[];
  totals: {
    generationKwh: number;
    consumptionKwh: number;
    selfUseKwh: number;
    exportKwh: number;
    billBeforePence: number;
    billAfterPence: number;
    savingPence: number;
    savingPct: number;
    /** Share of generation used at home. */
    selfConsumption: number;
    /** Share of the home's use met by solar (and battery). */
    selfSufficiency: number;
  };
}

/** First year, month by month. Self-use each month is capped at that month's consumption. */
export function firstYear(input: { annualGenerationKwh: number; generationShape?: readonly number[] | null; consumption: readonly number[]; selfConsumption: number; tariff: Tariff }): FirstYear {
  const generation = spreadByMonth(input.annualGenerationKwh, input.generationShape);
  const consumption = [...input.consumption];
  const sc = Math.min(1, Math.max(0, input.selfConsumption));
  const selfUse = generation.map((g, i) => Math.min(consumption[i]!, g * sc));
  const exported = generation.map((g, i) => g - selfUse[i]!);
  const t = input.tariff;
  const standing = DAYS.map((d) => d * t.standingChargePencePerDay);
  const billBeforePence = consumption.map((c, i) => Math.round(c * t.unitRatePence + standing[i]!));
  const billAfterPence = consumption.map((c, i) => Math.round((c - selfUse[i]!) * t.unitRatePence + standing[i]! - exported[i]! * t.exportRatePence));
  const totals = {
    generationKwh: Math.round(sum(generation)),
    consumptionKwh: Math.round(sum(consumption)),
    selfUseKwh: Math.round(sum(selfUse)),
    exportKwh: Math.round(sum(exported)),
    billBeforePence: sum(billBeforePence),
    billAfterPence: sum(billAfterPence),
    savingPence: 0,
    savingPct: 0,
    selfConsumption: sum(generation) ? sum(selfUse) / sum(generation) : 0,
    selfSufficiency: sum(consumption) ? sum(selfUse) / sum(consumption) : 0,
  };
  totals.savingPence = totals.billBeforePence - totals.billAfterPence;
  totals.savingPct = totals.billBeforePence ? totals.savingPence / totals.billBeforePence : 0;
  return { generation, consumption, selfUse, exported, billBeforePence, billAfterPence, totals };
}

export interface CashFlowRow {
  year: number;
  generationKwh: number;
  selfUseValuePence: number;
  exportValuePence: number;
  expensesPence: number;
  totalPence: number;
  cumulativePence: number;
  billWithoutPence: number;
  billWithPence: number;
}

export interface CashFlow {
  rows: CashFlowRow[];
  npvPence: number;
  /** Internal rate of return as a fraction, or null if it can't be found. */
  irr: number | null;
  /** Years until discounted cash flows repay the cost, or null if not within the lifetime. */
  discountedPaybackYears: number | null;
  simplePaybackYears: number | null;
  totalSavingPence: number;
}

/**
 * Year-by-year cash flow. Year 0 is the cost. Each later year: generation
 * after degradation, the self-used share valued at the inflating unit rate,
 * the rest exported at a flat export rate.
 */
export function cashFlow(input: { costPence: number; firstYear: FirstYear; tariff: Tariff; assumptions: FinanceAssumptions; replacementCosts?: { year: number; pence: number }[] }): CashFlow {
  const a = input.assumptions;
  const fy = input.firstYear.totals;
  const infl = a.electricityInflationPct / 100;
  const r = a.discountRatePct / 100;
  const rows: CashFlowRow[] = [
    { year: 0, generationKwh: 0, selfUseValuePence: 0, exportValuePence: 0, expensesPence: input.costPence, totalPence: -input.costPence, cumulativePence: -input.costPence, billWithoutPence: 0, billWithPence: 0 },
  ];
  const selfShare = fy.generationKwh ? fy.selfUseKwh / fy.generationKwh : 0;
  const standingYear = 365.25 * input.tariff.standingChargePencePerDay;
  for (let y = 1; y <= a.lifetimeYears; y++) {
    const output = (1 - a.degradationFirstYearPct / 100) * (1 - a.degradationAnnualPct / 100) ** (y - 1);
    const gen = fy.generationKwh * output;
    const priceUp = (1 + infl) ** (y - 1);
    const rate = input.tariff.unitRatePence * priceUp;
    const selfUse = Math.min(gen * selfShare, fy.consumptionKwh);
    const exported = gen - selfUse;
    const selfUseValue = Math.round(selfUse * rate);
    const exportValue = Math.round(exported * input.tariff.exportRatePence);
    const expenses = (input.replacementCosts ?? []).filter((c) => c.year === y).reduce((n, c) => n + c.pence, 0);
    const total = selfUseValue + exportValue - expenses;
    const billWithout = Math.round(fy.consumptionKwh * rate + standingYear * priceUp);
    rows.push({
      year: y,
      generationKwh: Math.round(gen),
      selfUseValuePence: selfUseValue,
      exportValuePence: exportValue,
      expensesPence: expenses,
      totalPence: total,
      cumulativePence: rows[y - 1]!.cumulativePence + total,
      billWithoutPence: billWithout,
      billWithPence: billWithout - selfUseValue - exportValue,
    });
  }
  const npvAt = (rate: number) => rows.reduce((n, row) => n + row.totalPence / (1 + rate) ** row.year, 0);
  return {
    rows,
    npvPence: Math.round(npvAt(r)),
    irr: irr(npvAt),
    discountedPaybackYears: payback(rows, r),
    simplePaybackYears: payback(rows, 0),
    totalSavingPence: rows.slice(1).reduce((n, row) => n + row.totalPence, 0),
  };
}

/** Rate where NPV is zero, by bisection between -99% and 100%. */
function irr(npvAt: (r: number) => number): number | null {
  let lo = -0.99;
  let hi = 1;
  if (npvAt(lo) * npvAt(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npvAt(lo) * npvAt(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return Math.round(((lo + hi) / 2) * 10000) / 10000;
}

/** Years (with a fraction) until cumulative discounted cash flow reaches zero. */
function payback(rows: readonly CashFlowRow[], rate: number): number | null {
  let cum = 0;
  for (const row of rows) {
    const d = row.totalPence / (1 + rate) ** row.year;
    if (row.year > 0 && cum < 0 && cum + d >= 0) return Math.round((row.year - 1 + -cum / d) * 10) / 10;
    cum += d;
  }
  return null;
}

/** "10–11 years" style label for a payback period. */
export function paybackLabel(years: number | null): string {
  if (years === null) return "Not within the system lifetime";
  const lo = Math.floor(years);
  return lo === years ? `${lo} years` : `${lo}–${lo + 1} years`;
}

/** CO2 avoided per year from generation and a grid emissions factor (kg CO2 per kWh). */
export function co2AvoidedKg(generationKwh: number, kgPerKwh: number | null): number | null {
  return kgPerKwh === null ? null : Math.round(generationKwh * kgPerKwh);
}
