import "server-only";
import type { Tx } from "@goinstall/db";
import type { EvDesignPayload } from "@/lib/actions/ev-design";

export type EvInitial = EvDesignPayload & { version: number | null; savedAt: string | null; computed: { cableSizeMm2: number | null; voltDropPct: number | null; maxDemandA: number | null; loadManagement: boolean | null } };

/** The active EV design, or an empty one ready to start. */
export async function loadEvDesign(tx: Tx, projectId: string): Promise<EvInitial> {
  const d = await tx.selectFrom("ev_designs").selectAll().where("project_id", "=", projectId).where("is_active", "=", true).executeTakeFirst();
  if (!d) {
    return {
      chargerProductId: null,
      mounting: "wall",
      tethered: null,
      background: "aerial",
      supplyPoint: null,
      chargerPoint: null,
      supplyLabel: "Consumer unit",
      chargerLabel: "Charger",
      route: [],
      routeMethods: [],
      routeLengthM: null,
      routeLengthMeasured: true,
      mainFuseA: null,
      phases: 1,
      existingDemandA: null,
      earthing: null,
      protection: null,
      solarDivert: false,
      version: null,
      savedAt: null,
      computed: { cableSizeMm2: null, voltDropPct: null, maxDemandA: null, loadManagement: null },
    };
  }
  return {
    chargerProductId: d.charger_product_id,
    mounting: d.mounting as "wall" | "post",
    tethered: d.tethered,
    background: d.background as "aerial" | "plain" | "photo",
    supplyPoint: d.supply_point as { x: number; y: number } | null,
    chargerPoint: d.charger_point as { x: number; y: number } | null,
    supplyLabel: d.supply_label ?? "Consumer unit",
    chargerLabel: d.charger_label ?? "Charger",
    route: d.route as { x: number; y: number }[],
    routeMethods: d.route_methods as string[],
    routeLengthM: d.route_length_m === null ? null : Number(d.route_length_m),
    routeLengthMeasured: d.route_length_measured,
    mainFuseA: d.main_fuse_a,
    phases: (d.phases ?? 1) as 1 | 3,
    existingDemandA: d.existing_demand_a === null ? null : Number(d.existing_demand_a),
    earthing: d.earthing,
    protection: d.protection,
    solarDivert: d.solar_divert,
    version: d.version,
    savedAt: d.created_at.toISOString(),
    computed: {
      cableSizeMm2: d.cable_size_mm2 === null ? null : Number(d.cable_size_mm2),
      voltDropPct: d.volt_drop_pct === null ? null : Number(d.volt_drop_pct),
      maxDemandA: d.max_demand_a === null ? null : Number(d.max_demand_a),
      loadManagement: d.load_management,
    },
  };
}
