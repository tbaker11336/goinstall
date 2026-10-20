"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import type { ActionResult } from "./crm";
import { saveSolarDesignAction, type SolarDesignPayload } from "./design";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

function optionalNumber(raw: FormDataEntryValue | null, label: string, max: number): number | null | { error: string } {
  const v = String(raw ?? "").replace(/[,£p\s]/gi, "");
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) return { error: `${label}: enter a number` };
  return n;
}

/** Design tab: the customer's electricity use and tariff, from their bills. */
export async function saveEnergyProfileAction(projectId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!z.uuid().safeParse(projectId).success) return { error: "Project not found" };
  const fields: Record<string, number | null> = {};
  for (const [k, label, max] of [
    ["annual", "Annual use", 1_000_000],
    ["unit", "Unit rate", 500],
    ["standing", "Standing charge", 1000],
    ["export", "Export tariff", 500],
  ] as const) {
    const n = optionalNumber(form.get(k), label, max);
    if (n && typeof n === "object") return n;
    fields[k] = n;
  }
  const monthly: (number | null)[] = [];
  for (const m of MONTHS) {
    const n = optionalNumber(form.get(`m_${m}`), "Monthly use", 100_000);
    if (n && typeof n === "object") return n;
    monthly.push(n === null ? null : Math.round(n));
  }
  const filled = monthly.filter((m) => m !== null).length;
  if (filled > 0 && filled < 12) return { error: "Fill in all 12 months, or leave them all blank and give the annual figure." };
  const monthlyKwh = filled === 12 ? (monthly as number[]) : null;
  const annual = monthlyKwh ? monthlyKwh.reduce((n, x) => n + x, 0) : fields.annual === null ? null : Math.round(fields.annual!);
  if (annual !== null && annual < 1) return { error: "Annual use must be at least 1 kWh." };
  const source = z.enum(["bills", "survey", "estimate"]).catch("bills").parse(form.get("source"));
  const values = {
    annual_kwh: annual,
    monthly_kwh: monthlyKwh,
    unit_rate_pence: fields.unit === null ? null : String(fields.unit),
    standing_charge_pence: fields.standing === null ? null : String(fields.standing),
    export_rate_pence: fields.export === null ? null : String(fields.export),
    tariff_name: String(form.get("tariff_name") ?? "").trim().slice(0, 100) || null,
    source,
  };
  const active = await asUser(async (tx) => {
    const project = await tx.selectFrom("projects").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return null;
    await tx
      .insertInto("energy_profiles")
      .values({ project_id: projectId, ...values })
      .onConflict((oc) => oc.columns(["company_id", "project_id"]).doUpdateSet(values))
      .execute();
    return (await tx.selectFrom("solar_designs").select(["roof_source", "segments", "panel_product_id", "inverter_product_id", "battery_product_id", "battery_count", "site_markup", "string_plan"]).where("project_id", "=", projectId).where("is_active", "=", true).executeTakeFirst()) ?? false;
  });
  if (active === null) return { error: "Project not found" };
  // Self-consumption depends on use, so the active design is saved again (a new version) with the new figures.
  if (active) {
    const r = await saveSolarDesignAction(projectId, {
      roofSource: active.roof_source as "google_solar" | "drawn",
      segments: active.segments as SolarDesignPayload["segments"],
      panelProductId: active.panel_product_id,
      inverterProductId: active.inverter_product_id,
      batteryProductId: active.battery_product_id,
      batteryCount: active.battery_count,
      siteMarkup: active.site_markup as SolarDesignPayload["siteMarkup"],
      stringPlan: active.string_plan as SolarDesignPayload["stringPlan"],
    });
    if (r.error) return { error: `Saved, but the design couldn't be recalculated: ${r.error}` };
  }
  revalidatePath(`/projects/${projectId}/design`);
  return { message: active ? "Saved, and the design recalculated with these figures." : "Saved." };
}
