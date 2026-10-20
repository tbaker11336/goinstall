"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import type { ActionResult } from "./crm";

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
  return asUser(async (tx) => {
    const project = await tx.selectFrom("projects").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    await tx
      .insertInto("energy_profiles")
      .values({ project_id: projectId, ...values })
      .onConflict((oc) => oc.columns(["company_id", "project_id"]).doUpdateSet(values))
      .execute();
    revalidatePath(`/projects/${projectId}/design`);
    return { message: "Saved. The saving and payback use these figures; the design recalculates on its next change." };
  });
}
