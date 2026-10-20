"use server";

import { DESIGN_SETTING_FIELDS, FINANCE_FIELDS, parseCsv, parseDesignSettings, RULE_PARSERS, RULE_TABLES, type RuleTableKind } from "@goinstall/core";
import { sql } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/auth";
import type { ActionResult } from "./crm";

/**
 * Upload a new version of a rule table. The previous version stays stored
 * (designs saved with it keep their figures) but stops being used.
 */
export async function uploadRuleTableAction(kind: RuleTableKind, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!(kind in RULE_TABLES)) return { error: "Unknown table" };
  const file = form.get("file");
  const sourceNote = String(form.get("source_note") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 3_000_000) return { error: "That file is too large (3 MB maximum)." };
  if (!sourceNote) return { error: "Say where the values come from, e.g. the document and version." };
  const parsed = RULE_PARSERS[kind](parseCsv(await file.text()));
  if ("error" in parsed) return { error: parsed.error };
  return asUser(async (tx) => {
    const last = await tx.selectFrom("calc_tables").select((eb) => eb.fn.max("version").as("v")).where("kind", "=", kind).executeTakeFirst();
    await tx.updateTable("calc_tables").set({ is_active: false }).where("kind", "=", kind).where("is_active", "=", true).execute();
    await tx
      .insertInto("calc_tables")
      .values({ kind, version: (Number(last?.v) || 0) + 1, rows: JSON.stringify(parsed.rows), source_note: sourceNote.slice(0, 300), file_name: file.name.slice(0, 200) })
      .execute();
    revalidatePath("/settings/design");
    return { message: `${RULE_TABLES[kind].label} uploaded: ${parsed.rows.length} rows.` };
  }, ["admin"]);
}

export async function saveDesignSettingsAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = parseDesignSettings(Object.fromEntries(DESIGN_SETTING_FIELDS.map((f) => [f.key, String(form.get(f.key) ?? "")])));
  if ("error" in parsed) return { error: parsed.error };
  return asUser(async (tx, session) => {
    await tx.updateTable("companies").set({ design_settings: sql`${JSON.stringify(parsed.settings)}::jsonb` }).where("id", "=", session.companyId).execute();
    revalidatePath("/settings/design");
    return { message: "Design settings saved." };
  }, ["admin"]);
}

/** Savings and payback: finance assumptions, default tariff and grid emissions factor. */
export async function saveFinanceSettingsAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const finance: Record<string, number> = {};
  for (const f of FINANCE_FIELDS) {
    const v = Number(String(form.get(f.key) ?? "").trim());
    if (!String(form.get(f.key) ?? "").trim() || !Number.isFinite(v) || v < f.min || v > f.max) return { error: `${f.label}: enter a number from ${f.min} to ${f.max}.` };
    finance[f.key] = v;
  }
  const opt = (k: string, max: number) => {
    const raw = String(form.get(k) ?? "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= max ? String(n) : undefined;
  };
  const unit = opt("default_unit_rate_pence", 500);
  const standing = opt("default_standing_charge_pence", 1000);
  const exp = opt("default_export_rate_pence", 500);
  const grid = opt("grid_emissions_kg_per_kwh", 2);
  if ([unit, standing, exp, grid].includes(undefined)) return { error: "Tariff and emissions values must be numbers." };
  const gridSource = String(form.get("grid_emissions_source") ?? "").trim().slice(0, 200) || null;
  if (grid && !gridSource) return { error: "Say where the emissions factor comes from, e.g. the published source and year." };
  return asUser(async (tx, session) => {
    await tx
      .updateTable("companies")
      .set({
        finance_settings: JSON.stringify(finance),
        default_unit_rate_pence: unit ?? null,
        default_standing_charge_pence: standing ?? null,
        default_export_rate_pence: exp ?? null,
        grid_emissions_kg_per_kwh: grid ?? null,
        grid_emissions_source: grid ? gridSource : null,
      })
      .where("id", "=", session.companyId)
      .execute();
    revalidatePath("/settings/design");
    return { message: "Savings and payback settings saved." };
  }, ["admin"]);
}
