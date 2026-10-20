"use server";

import { CABLE_KINDS, drawnStrings, evaluateSolarDesign, MARKER_KINDS, type Specs } from "@goinstall/core";
import type { Tx } from "@goinstall/db";
import { createPvgisClient, googleYearlyEstimateKwh } from "@goinstall/integrations";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { loadDesignRules } from "@/lib/design-rules";
import { loadEnergy } from "@/lib/energy";
import { roofData } from "@/lib/site";
import { surveyAnswers } from "@/lib/survey";

const rect = z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().positive().max(10), h: z.number().positive().max(10) });
const point = z.object({ x: z.number().finite().min(-500).max(500), y: z.number().finite().min(-500).max(500) });
const markupId = z.string().min(1).max(40);
const markupSchema = z.object({
  markers: z.array(z.object({ id: markupId, kind: z.enum(MARKER_KINDS), x: point.shape.x, y: point.shape.y, note: z.string().max(300) })).max(60),
  cables: z.array(z.object({ id: markupId, kind: z.enum(CABLE_KINDS), points: z.array(point).min(2).max(60), extraM: z.number().min(0).max(200), label: z.string().max(80) })).max(40),
  measurements: z.array(z.object({ id: markupId, a: point, b: point })).max(40),
});
const segmentSchema = z.object({
  id: z.string().min(1).max(8),
  label: z.string().max(80),
  pitch: z.number().min(0).max(70),
  azimuth: z.number().min(0).max(360),
  origin: z.object({ x: z.number().finite(), y: z.number().finite() }),
  width: z.number().positive().max(60),
  depth: z.number().positive().max(30),
  insetLeft: z.number().min(0).max(30),
  insetRight: z.number().min(0).max(30),
  panels: z.array(rect.extend({ s: z.number().int().min(1).max(30).nullable().optional() })).max(200),
  obstructions: z.array(rect.extend({ label: z.string().max(40) })).max(30),
  landscape: z.boolean(),
  shadeFactor: z.number().gt(0).max(1),
  used: z.boolean(),
  sunshineHours: z.number().nullable(),
  suggestedPanels: z.number().nullable(),
});
const designSchema = z.object({
  roofSource: z.enum(["google_solar", "drawn"]),
  segments: z.array(segmentSchema).max(20),
  panelProductId: z.uuid().nullable(),
  inverterProductId: z.uuid().nullable(),
  batteryProductId: z.uuid().nullable(),
  batteryCount: z.number().int().min(0).max(10),
  siteMarkup: markupSchema,
  stringPlan: z.object({ strings: z.array(z.object({ mppt: z.number().int().min(1).max(12) })).max(30) }).nullable(),
});
export type SolarDesignPayload = z.infer<typeof designSchema>;

async function product(tx: Tx, id: string | null) {
  if (!id) return null;
  const p = await tx.selectFrom("products").select(["id", "specs"]).where("id", "=", id).executeTakeFirst();
  return p ? { id: p.id, specs: (p.specs ?? {}) as Specs } : null;
}

const arrayKey = (segments: SolarDesignPayload["segments"]) => JSON.stringify(segments.filter((s) => s.used && s.panels.length).map((s) => [s.panels.length, s.pitch, s.azimuth]));

/**
 * Autosave: every change is a new version; the server recalculates the
 * figures from the stored rules and catalogue so what's saved is trusted.
 */
export async function saveSolarDesignAction(projectId: string, payload: SolarDesignPayload): Promise<{ error?: string; version?: number; savedAt?: string }> {
  if (!z.uuid().safeParse(projectId).success) return { error: "Project not found" };
  const parsed = designSchema.safeParse(payload);
  if (!parsed.success) return { error: `Design not saved: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` };
  const d = parsed.data;
  return asUser(async (tx) => {
    const project = await tx.selectFrom("projects").select(["id", "site_postcode", "products", "lat", "lng"]).where("id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    const [rules, panel, inverter, battery, answers, previous, energy] = await Promise.all([
      loadDesignRules(tx),
      product(tx, d.panelProductId),
      product(tx, d.inverterProductId),
      product(tx, d.batteryProductId),
      surveyAnswers(tx, projectId),
      tx.selectFrom("solar_designs").select(["version", "segments", "pvgis_kwh", "pvgis_monthly"]).where("project_id", "=", projectId).orderBy("version", "desc").limit(1).executeTakeFirst(),
      loadEnergy(tx, projectId),
    ]);
    // Google's own yearly estimate and imagery date (from the cached Solar API response) sit beside MCS as a cross-check.
    const roof = await roofData(tx, projectId, null);
    const wired = drawnStrings(d.segments, d.stringPlan);
    const arrays = d.segments.filter((s) => s.used).map((s) => ({ id: s.id, label: s.label, pitch: s.pitch, azimuth: s.azimuth, panelCount: s.panels.length, shadeFactor: s.shadeFactor }));
    const result = evaluateSolarDesign({
      arrays,
      panel,
      inverter,
      battery: battery ? { usableKwh: Number(battery.specs.usable_kwh ?? battery.specs.capacity_kwh ?? 0), count: d.batteryCount } : null,
      postcode: project.site_postcode ?? "",
      phases: /three/i.test(answers.supply_phase ?? "") ? 3 : 1,
      // Energy use entered on the Design tab wins over the survey answer.
      survey: { occupancy: answers.occupancy ?? null, annualUsageKwh: energy.annualKwh },
      tariff: energy.unitRatePence !== null && energy.exportRatePence !== null ? { unitRatePence: energy.unitRatePence, exportRatePence: energy.exportRatePence } : null,
      hasEv: project.products.includes("ev"),
      wired,
      rules: { yields: rules.yields, zones: rules.zones, selfConsumption: rules.selfConsumption, settings: rules.settings },
    });

    // PVGIS cross-check: only when the arrays changed (it's an external call).
    let pvgisKwh = previous?.pvgis_kwh ?? null;
    let pvgisMonthly = previous?.pvgis_monthly ?? null;
    const changed = !previous || arrayKey(previous.segments as SolarDesignPayload["segments"]) !== arrayKey(d.segments);
    if (changed) {
      pvgisKwh = null;
      pvgisMonthly = null;
      if (project.lat != null && project.lng != null && rules.settings.pvgisLossPct != null && panel?.specs.watts_peak) {
        try {
          const pvgis = createPvgisClient();
          const wp = Number(panel.specs.watts_peak);
          const per = await Promise.all(
            arrays
              .filter((a) => a.panelCount)
              .map((a) => pvgis.pvcalc({ lat: project.lat!, lon: project.lng!, kWp: (a.panelCount * wp) / 1000, pitch: a.pitch, azimuth: a.azimuth, lossPct: rules.settings.pvgisLossPct! })),
          );
          if (per.length) {
            pvgisKwh = per.reduce((n, p) => n + p.annualKwh, 0);
            pvgisMonthly = Array.from({ length: 12 }, (_, m) => per.reduce((n, p) => n + (p.monthlyKwh[m] ?? 0), 0));
          }
        } catch {
          result.notes.push("PVGIS cross-check unavailable just now; it retries on the next change.");
        }
      }
    }
    if (rules.settings.pvgisLossPct == null) result.notes.push("Set PVGIS system losses in Settings › Design rules for the PVGIS cross-check.");

    const version = (previous?.version ?? 0) + 1;
    await tx.updateTable("solar_designs").set({ is_active: false }).where("project_id", "=", projectId).where("is_active", "=", true).execute();
    await tx
      .insertInto("solar_designs")
      .values({
        project_id: projectId,
        version,
        roof_source: d.roofSource,
        segments: JSON.stringify(d.segments),
        site_markup: JSON.stringify(d.siteMarkup),
        // Only kept while strings are wired by hand.
        string_plan: wired.strings.length && d.stringPlan ? JSON.stringify(d.stringPlan) : null,
        panel_product_id: d.panelProductId,
        inverter_product_id: d.inverterProductId,
        battery_product_id: d.batteryProductId,
        battery_count: d.batteryProductId ? d.batteryCount : 0,
        panel_count: result.panelCount,
        kwp: result.kWp,
        annual_kwh_mcs: result.annualKwh,
        pvgis_kwh: pvgisKwh,
        pvgis_monthly: pvgisMonthly,
        self_consumption: result.selfUse,
        self_consumption_with_battery: result.selfUseWithBattery,
        strings: result.strings ? JSON.stringify(result.strings) : null,
        dc_ac_ratio: result.dcAc,
        export_kw: result.exportKw,
        connection_form: result.connection?.form ?? null,
        calc_notes: JSON.stringify(result.notes),
        mcs_arrays: JSON.stringify(result.perArray),
        mcs_zone: result.zone,
        google_yearly_kwh: roof.insights && panel?.specs.watts_peak ? googleYearlyEstimateKwh(roof.insights, result.panelCount, Number(panel.specs.watts_peak)) : null,
        imagery_date: roof.insights?.imageryDate ?? null,
      })
      .execute();
    revalidatePath(`/projects/${projectId}/design`);
    return { version, savedAt: new Date().toISOString() };
  });
}

/** Restore an earlier version by saving it again as the newest. */
export async function restoreSolarDesignAction(projectId: string, version: number): Promise<{ error?: string; version?: number }> {
  if (!z.uuid().safeParse(projectId).success || !Number.isInteger(version)) return { error: "Design not found" };
  const old = await asUser((tx) => tx.selectFrom("solar_designs").selectAll().where("project_id", "=", projectId).where("version", "=", version).executeTakeFirst());
  if (!old) return { error: "Design not found" };
  return saveSolarDesignAction(projectId, {
    roofSource: old.roof_source as "google_solar" | "drawn",
    segments: old.segments as SolarDesignPayload["segments"],
    panelProductId: old.panel_product_id,
    inverterProductId: old.inverter_product_id,
    batteryProductId: old.battery_product_id,
    batteryCount: old.battery_count,
    siteMarkup: old.site_markup as SolarDesignPayload["siteMarkup"],
    stringPlan: old.string_plan as SolarDesignPayload["stringPlan"],
  });
}

