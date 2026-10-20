"use server";

import { evaluateEvDesign, type Specs } from "@goinstall/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { loadDesignRules } from "@/lib/design-rules";

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const evSchema = z.object({
  chargerProductId: z.uuid().nullable(),
  mounting: z.enum(["wall", "post"]),
  tethered: z.boolean().nullable(),
  background: z.enum(["aerial", "plain", "photo"]),
  supplyPoint: point.nullable(),
  chargerPoint: point.nullable(),
  supplyLabel: z.string().max(80),
  chargerLabel: z.string().max(80),
  route: z.array(point).max(40),
  routeMethods: z.array(z.string().max(60)).max(40),
  routeLengthM: z.number().positive().max(500).nullable(),
  routeLengthMeasured: z.boolean(),
  mainFuseA: z.number().int().positive().max(200).nullable(),
  phases: z.union([z.literal(1), z.literal(3)]),
  existingDemandA: z.number().min(0).max(400).nullable(),
  earthing: z.string().max(60).nullable(),
  protection: z.string().max(200).nullable(),
  solarDivert: z.boolean(),
});
export type EvDesignPayload = z.infer<typeof evSchema>;

/** Autosave the EV design as a new version, with figures recalculated server-side. */
export async function saveEvDesignAction(projectId: string, payload: EvDesignPayload): Promise<{ error?: string; version?: number; savedAt?: string }> {
  if (!z.uuid().safeParse(projectId).success) return { error: "Project not found" };
  const parsed = evSchema.safeParse(payload);
  if (!parsed.success) return { error: `Design not saved: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` };
  const d = parsed.data;
  return asUser(async (tx) => {
    const project = await tx.selectFrom("projects").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    const [rules, charger, previous] = await Promise.all([
      loadDesignRules(tx),
      d.chargerProductId ? tx.selectFrom("products").select("specs").where("id", "=", d.chargerProductId).where("category", "=", "ev_charger").executeTakeFirst() : Promise.resolve(undefined),
      tx.selectFrom("ev_designs").select("version").where("project_id", "=", projectId).orderBy("version", "desc").limit(1).executeTakeFirst(),
    ]);
    if (d.chargerProductId && !charger) return { error: "That charger isn't in the catalogue." };
    const r = evaluateEvDesign({
      route: d.route,
      routeMethods: d.routeMethods,
      routeLengthM: d.routeLengthM,
      routeLengthMeasured: d.routeLengthMeasured,
      charger: charger ? ((charger.specs ?? {}) as Specs as { rated_a?: number; rated_kw?: number; phases?: number }) : null,
      mainFuseA: d.mainFuseA,
      existingDemandA: d.existingDemandA,
      rules: { cables: rules.cables, voltDropLimitPct: rules.settings.evVoltDropLimitPct ?? null, chargerDiversity: rules.settings.evChargerDiversity ?? null },
    });
    const version = (previous?.version ?? 0) + 1;
    await tx.updateTable("ev_designs").set({ is_active: false }).where("project_id", "=", projectId).where("is_active", "=", true).execute();
    await tx
      .insertInto("ev_designs")
      .values({
        project_id: projectId,
        version,
        charger_product_id: d.chargerProductId,
        mounting: d.mounting,
        tethered: d.tethered,
        background: d.background,
        supply_point: d.supplyPoint ? JSON.stringify(d.supplyPoint) : null,
        charger_point: d.chargerPoint ? JSON.stringify(d.chargerPoint) : null,
        supply_label: d.supplyLabel,
        charger_label: d.chargerLabel,
        route: JSON.stringify(d.route),
        route_methods: JSON.stringify(d.routeMethods),
        route_length_m: r.lengthM,
        route_length_measured: d.routeLengthMeasured,
        cable_size_mm2: r.cableSizeMm2,
        volt_drop_pct: r.voltDropPct,
        main_fuse_a: d.mainFuseA,
        phases: d.phases,
        existing_demand_a: d.existingDemandA,
        max_demand_a: r.demandA,
        load_management: r.loadManagementNeeded,
        earthing: d.earthing,
        protection: d.protection,
        solar_divert: d.solarDivert,
        // Every EV charger install is notified to the DNO (spec: paperwork).
        dno_notification: true,
        calc_notes: JSON.stringify(r.notes),
      })
      .execute();
    revalidatePath(`/projects/${projectId}/design`);
    return { version, savedAt: new Date().toISOString() };
  });
}
