/**
 * The design snapshot a proposal is built from (stored on the proposal, so a
 * sent proposal never changes), and the finance worked out from it once the
 * price is known.
 */
import { cashFlow, co2AvoidedKg, firstYear, type CashFlow, type FinanceAssumptions, type FirstYear, type Tariff } from "./finance";

export interface SummaryArray {
  id: string;
  label: string;
  panels: number;
  kWp: number;
  pitch: number;
  azimuth: number;
  shadeFactor: number;
  kwhPerKwp: number | null;
  annualKwh: number | null;
}

export interface SummaryProduct {
  role: "panel" | "inverter" | "battery" | "ev_charger" | "mounting";
  count: number;
  name: string;
  make: string | null;
  model: string;
  specs: Record<string, number | boolean | string>;
}

export interface LayoutSnapshot {
  /** The aerial image saved when the proposal was built. */
  path: string;
  widthM: number;
  segments: { origin: { x: number; y: number }; width: number; depth: number; pitch: number; azimuth: number; panels: { x: number; y: number; w: number; h: number }[] }[];
}

export interface ProposalSummary {
  kWp: number | null;
  panelCount: number | null;
  annualKwh: number | null;
  selfUse: number | null;
  yearlySavingPence: number | null;
  evRouteM: number | null;
  segments: unknown[];
  details?: {
    zone: string | null;
    arrays: SummaryArray[];
    selfUsePvOnly: number | null;
    selfUseWithBattery: number | null;
    batteryUsableKwh: number | null;
    pvgisMonthly: number[] | null;
    googleKwh: number | null;
    imageryDate: string | null;
    products: SummaryProduct[];
  };
  energy?: { annualKwh: number | null; monthlyKwh: number[] | null; consumption: number[] | null; tariff: Tariff | null; tariffName: string | null; source: string };
  assumptions?: FinanceAssumptions;
  emissions?: { kgPerKwh: number; source: string | null } | null;
  layout?: LayoutSnapshot | null;
  finance?: ProposalFinance | null;
}

export interface ProposalFinance {
  firstYear: FirstYear;
  cashFlow: CashFlow;
  co2KgPerYear: number | null;
}

/** Finance for the proposal's total price, or null (with why) when inputs are missing. */
export function financeForSummary(s: ProposalSummary, totalPence: number): { finance: ProposalFinance | null; missing: string[] } {
  const missing: string[] = [];
  if (!s.annualKwh) missing.push("an MCS annual generation figure");
  if (s.selfUse === null || s.selfUse === undefined) missing.push("a self-consumption figure");
  if (!s.energy?.consumption) missing.push("the customer's electricity use");
  if (!s.energy?.tariff) missing.push("the tariff (unit rate, standing charge, export)");
  if (!s.assumptions) missing.push("finance assumptions");
  if (missing.length || totalPence <= 0) return { finance: null, missing };
  const fy = firstYear({ annualGenerationKwh: s.annualKwh!, generationShape: s.details?.pvgisMonthly ?? null, consumption: s.energy!.consumption!, selfConsumption: Number(s.selfUse), tariff: s.energy!.tariff! });
  const cf = cashFlow({ costPence: totalPence, firstYear: fy, tariff: s.energy!.tariff!, assumptions: s.assumptions! });
  return { finance: { firstYear: fy, cashFlow: cf, co2KgPerYear: s.emissions ? co2AvoidedKg(fy.totals.generationKwh, s.emissions.kgPerKwh) : null }, missing: [] };
}
