import "server-only";
import type { CableRow, DesignSettings, McsYieldRow, McsZoneRow, RuleTableKind, SelfConsumptionRow } from "@goinstall/core";
import type { Tx } from "@goinstall/db";

export interface DesignRules {
  settings: DesignSettings;
  yields: McsYieldRow[] | null;
  zones: McsZoneRow[] | null;
  selfConsumption: SelfConsumptionRow[] | null;
  cables: CableRow[] | null;
  versions: Partial<Record<RuleTableKind, { version: number; sourceNote: string; createdAt: Date; rows: number }>>;
}

/** The company's active rule tables and design settings. */
export async function loadDesignRules(tx: Tx): Promise<DesignRules> {
  const [tables, company] = await Promise.all([
    tx.selectFrom("calc_tables").select(["kind", "version", "rows", "source_note", "created_at"]).where("is_active", "=", true).execute(),
    tx.selectFrom("companies").select("design_settings").executeTakeFirst(),
  ]);
  const get = <T>(kind: RuleTableKind) => (tables.find((t) => t.kind === kind)?.rows as T[] | undefined) ?? null;
  return {
    settings: (company?.design_settings ?? {}) as DesignSettings,
    yields: get<McsYieldRow>("mcs_yield"),
    zones: get<McsZoneRow>("mcs_zones"),
    selfConsumption: get<SelfConsumptionRow>("self_consumption"),
    cables: get<CableRow>("ev_cables"),
    versions: Object.fromEntries(
      tables.map((t) => [t.kind, { version: t.version, sourceNote: t.source_note, createdAt: t.created_at, rows: (t.rows as unknown[]).length }]),
    ),
  };
}
