import "server-only";
import { drawnStrings, parseAmps, sldModel, type InverterSpecs, type PanelSpecs, type SiteMarkup, type SldModel, type Specs, type StringPlan } from "@goinstall/core";
import type { Tx } from "@goinstall/db";
import type { SolarDesignPayload } from "./actions/design";
import { loadDesignRules } from "./design-rules";
import { AERIAL_SIZE_PX, AERIAL_ZOOM, aerialWidthM, googleMaps } from "./site";
import { surveyAnswers } from "./survey";

export type Segment = SolarDesignPayload["segments"][number];

export interface DesignDoc {
  companyName: string;
  mcsNumber: string | null;
  brand: string;
  contactName: string;
  siteAddress: string;
  version: number;
  savedAt: Date;
  kWp: number;
  panelCount: number;
  annualKwh: number | null;
  segments: Segment[];
  markup: SiteMarkup;
  panelName: string | null;
  inverterName: string | null;
  batteryName: string | null;
  batteryCount: number;
  /** String number → panels, as wired (or the automatic split). */
  strings: { n: number; panels: number; mppt: number }[];
  wiredByHand: boolean;
  sld: SldModel;
  notes: string[];
  position: { lat: number; lng: number } | null;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Everything the plan and SLD downloads draw, from the active solar design. Null without one. */
export async function loadDesignDoc(tx: Tx, projectId: string): Promise<DesignDoc | null> {
  const d = await tx.selectFrom("solar_designs").selectAll().where("project_id", "=", projectId).where("is_active", "=", true).executeTakeFirst();
  if (!d) return null;
  const [project, company, rules, answers, ev] = await Promise.all([
    tx
      .selectFrom("projects as p")
      .innerJoin("contacts as c", "c.id", "p.contact_id")
      .select(["c.name as contact_name", "p.site_address_line1", "p.site_address_line2", "p.site_town", "p.site_postcode", "p.lat", "p.lng"])
      .where("p.id", "=", projectId)
      .executeTakeFirstOrThrow(),
    tx.selectFrom("companies").select(["name", "mcs_number", "brand_primary_colour"]).executeTakeFirstOrThrow(),
    loadDesignRules(tx),
    surveyAnswers(tx, projectId),
    tx
      .selectFrom("ev_designs as e")
      .leftJoin("products as pr", "pr.id", "e.charger_product_id")
      .select(["pr.name as charger_name", "pr.specs as charger_specs", "e.cable_size_mm2", "e.route_length_m", "e.protection", "e.main_fuse_a", "e.phases", "e.earthing"])
      .where("e.project_id", "=", projectId)
      .where("e.is_active", "=", true)
      .executeTakeFirst(),
  ]);
  const ids = [d.panel_product_id, d.inverter_product_id, d.battery_product_id].filter((x): x is string => Boolean(x));
  const products = ids.length ? await tx.selectFrom("products").select(["id", "name", "specs"]).where("id", "in", ids).execute() : [];
  const product = (id: string | null) => products.find((p) => p.id === id) ?? null;
  const panel = product(d.panel_product_id);
  const inverter = product(d.inverter_product_id);
  const battery = product(d.battery_product_id);

  const segments = (d.segments as Segment[]).filter((s) => s.used);
  const wired = drawnStrings(segments, d.string_plan as StringPlan | null);
  const strings = wired.strings.length ? wired.strings.map(({ n, panels, mppt }) => ({ n, panels, mppt })) : ((d.strings as number[] | null) ?? []).map((panels, i) => ({ n: i + 1, panels, mppt: i + 1 }));
  const phases: 1 | 3 = (ev?.phases ?? (/three/i.test(answers.supply_phase ?? "") ? 3 : 1)) === 3 ? 3 : 1;
  const chargerSpecs = (ev?.charger_specs ?? {}) as Specs;
  const markup = d.site_markup as unknown as SiteMarkup;
  const sld = sldModel({
    panel: panel ? { name: panel.name, specs: panel.specs as PanelSpecs } : null,
    inverter: inverter ? { name: inverter.name, specs: inverter.specs as InverterSpecs } : null,
    battery: battery && d.battery_count ? { name: battery.name, usableKwh: num((battery.specs as Specs).usable_kwh ?? (battery.specs as Specs).capacity_kwh), count: d.battery_count } : null,
    strings,
    minDesignTempC: rules.settings.minDesignTempC,
    supply: { phases, mainFuseA: ev?.main_fuse_a ?? parseAmps(answers.main_fuse ?? null), earthing: ev?.earthing ?? answers.earthing ?? null },
    ev: ev ? { name: ev.charger_name ?? "EV charger", kw: num(chargerSpecs.rated_kw), cableMm2: num(ev.cable_size_mm2), lengthM: num(ev.route_length_m), protection: ev.protection } : null,
    cables: markup.cables ?? [],
  });
  return {
    companyName: company.name,
    mcsNumber: company.mcs_number,
    brand: company.brand_primary_colour && /^#[0-9a-f]{6}$/i.test(company.brand_primary_colour) ? company.brand_primary_colour : "#0B7A62",
    contactName: project.contact_name,
    siteAddress: [project.site_address_line1, project.site_address_line2, project.site_town, project.site_postcode].filter(Boolean).join(", "),
    version: d.version,
    savedAt: d.created_at,
    kWp: Number(d.kwp),
    panelCount: d.panel_count,
    annualKwh: d.annual_kwh_mcs,
    segments,
    markup: { markers: markup.markers ?? [], cables: markup.cables ?? [], measurements: markup.measurements ?? [] },
    panelName: panel?.name ?? null,
    inverterName: inverter?.name ?? null,
    batteryName: battery?.name ?? null,
    batteryCount: d.battery_count,
    strings,
    wiredByHand: wired.strings.length > 0,
    sld,
    notes: d.calc_notes as string[],
    position: project.lat != null && project.lng != null ? { lat: project.lat, lng: project.lng } : null,
  };
}

/** The site's aerial tile for the plan PDF, or null without Google. */
export async function aerialTile(position: { lat: number; lng: number } | null): Promise<{ data: Buffer; widthM: number } | null> {
  const maps = googleMaps();
  if (!maps || !position) return null;
  try {
    const res = await fetch(maps.staticMapUrl(position, { zoom: AERIAL_ZOOM, size: AERIAL_SIZE_PX }));
    if (!res.ok) return null;
    return { data: Buffer.from(await res.arrayBuffer()), widthM: aerialWidthM(position.lat) };
  } catch {
    return null;
  }
}

export const fileStem = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design";
export const pdfResponse = (buf: Buffer, name: string) =>
  new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
