import "server-only";
import { DEFAULT_FINANCE, monthlyConsumption, type FinanceAssumptions, type Tariff } from "@goinstall/core";
import type { Tx } from "@goinstall/db";

export interface ProjectEnergy {
  /** Stored profile, if staff have entered one. */
  saved: boolean;
  annualKwh: number | null;
  monthlyKwh: number[] | null;
  /** 12 months of use, from monthly figures or the annual figure. */
  consumption: number[] | null;
  /** Each part falls back to the company default; null if still unknown. */
  unitRatePence: number | null;
  standingChargePencePerDay: number | null;
  exportRatePence: number | null;
  tariff: Tariff | null;
  tariffName: string | null;
  source: string;
  finance: FinanceAssumptions;
  gridEmissions: { kgPerKwh: number; source: string | null } | null;
  missing: string[];
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

/**
 * The customer's energy use and tariff for a project: what staff entered,
 * else the survey's annual use and the company's default tariff.
 */
export async function loadEnergy(tx: Tx, projectId: string): Promise<ProjectEnergy> {
  const [p, company, survey] = await Promise.all([
    tx.selectFrom("energy_profiles").selectAll().where("project_id", "=", projectId).executeTakeFirst(),
    tx
      .selectFrom("projects as pr")
      .innerJoin("companies as c", "c.id", "pr.company_id")
      .select(["c.finance_settings", "c.default_unit_rate_pence", "c.default_standing_charge_pence", "c.default_export_rate_pence", "c.grid_emissions_kg_per_kwh", "c.grid_emissions_source"])
      .where("pr.id", "=", projectId)
      .executeTakeFirstOrThrow(),
    tx
      .selectFrom("survey_fields as f")
      .innerJoin("surveys as s", "s.id", "f.survey_id")
      .select("f.value")
      .where("s.project_id", "=", projectId)
      .where("f.key", "=", "annual_usage_kwh")
      .executeTakeFirst(),
  ]);
  const surveyKwh = survey?.value && Number(survey.value) > 0 ? Math.round(Number(survey.value)) : null;
  const monthlyKwh = p?.monthly_kwh ?? null;
  const annualKwh = p?.annual_kwh ?? (monthlyKwh ? monthlyKwh.reduce((n, x) => n + x, 0) : surveyKwh);
  const unit = num(p?.unit_rate_pence) ?? num(company.default_unit_rate_pence);
  const standing = num(p?.standing_charge_pence) ?? num(company.default_standing_charge_pence);
  const exp = num(p?.export_rate_pence) ?? num(company.default_export_rate_pence);
  const missing: string[] = [];
  if (!annualKwh) missing.push("the customer's electricity use");
  if (unit === null) missing.push("the unit rate");
  if (standing === null) missing.push("the standing charge");
  if (exp === null) missing.push("the export tariff");
  return {
    saved: Boolean(p),
    annualKwh,
    monthlyKwh,
    consumption: monthlyConsumption({ annualKwh, monthlyKwh }),
    unitRatePence: unit,
    standingChargePencePerDay: standing,
    exportRatePence: exp,
    tariff: unit !== null && standing !== null && exp !== null ? { unitRatePence: unit, standingChargePencePerDay: standing, exportRatePence: exp } : null,
    tariffName: p?.tariff_name ?? null,
    source: p?.source ?? (surveyKwh ? "survey" : "estimate"),
    finance: { ...DEFAULT_FINANCE, ...((company.finance_settings ?? {}) as Partial<FinanceAssumptions>) },
    gridEmissions: company.grid_emissions_kg_per_kwh === null ? null : { kgPerKwh: Number(company.grid_emissions_kg_per_kwh), source: company.grid_emissions_source },
    missing,
  };
}
