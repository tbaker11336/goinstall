/**
 * Reading the business's rule tables from CSV. The app stores whatever the
 * business uploads (with a source note); these parsers only check shape and
 * types, never supply values.
 */
import type { CableRow } from "./ev";
import type { McsYieldRow, McsZoneRow, SelfConsumptionRow } from "./solar";

export const RULE_TABLES = {
  mcs_yield: {
    label: "MCS kWh/kWp table",
    help: "Either one row per value with columns zone, pitch, orientation, kwh_per_kwp; or the grid layout with columns zone, pitch, then one column per orientation (degrees from south).",
  },
  mcs_zones: { label: "MCS postcode zones", help: "Columns postcode (district such as OX16, or area such as OX) and zone." },
  self_consumption: {
    label: "MCS self-consumption table",
    help: "Columns occupancy, consumption_from_kwh, generation_from_kwh, battery_from_kwh, fraction (0–1). Each row is the lower bound of its band.",
  },
  ev_cables: { label: "Cable table", help: "Columns size_mm2, method (as you name installation methods), rating_a, mv_per_am." },
} as const;
export type RuleTableKind = keyof typeof RULE_TABLES;

type Parsed<T> = { rows: T[] } | { error: string };

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function columns(header: string[], wanted: string[]): Record<string, number> | { error: string } {
  const idx: Record<string, number> = {};
  const h = header.map(norm);
  for (const w of wanted) {
    const i = h.indexOf(w);
    if (i < 0) return { error: `Missing column "${w}". Found: ${header.join(", ")}.` };
    idx[w] = i;
  }
  return idx;
}

function num(v: string | undefined, label: string, line: number): number | { error: string } {
  const n = Number((v ?? "").replace(/,/g, "").trim());
  return v?.trim() && Number.isFinite(n) ? n : { error: `Line ${line}: ${label} "${v ?? ""}" isn't a number.` };
}

const isErr = (v: unknown): v is { error: string } => typeof v === "object" && v !== null && "error" in v;

export function parseYieldTable(rows: string[][]): Parsed<McsYieldRow> {
  const [header, ...data] = rows;
  if (!header || !data.length) return { error: "The file needs a header row and data." };
  const h = header.map(norm);
  const out: McsYieldRow[] = [];
  if (h.includes("orientation")) {
    const c = columns(header, ["zone", "pitch", "orientation", "kwh_per_kwp"]);
    if (isErr(c)) return c;
    for (const [i, r] of data.entries()) {
      const pitch = num(r[c.pitch!], "pitch", i + 2);
      const orientation = num(r[c.orientation!], "orientation", i + 2);
      const kwh = num(r[c.kwh_per_kwp!], "kwh_per_kwp", i + 2);
      for (const v of [pitch, orientation, kwh]) if (isErr(v)) return v;
      out.push({ zone: r[c.zone!]!.trim(), pitch: pitch as number, orientation: orientation as number, kwhPerKwp: kwh as number });
    }
  } else {
    const c = columns(header, ["zone", "pitch"]);
    if (isErr(c)) return c;
    const orientCols = header.map((x, i) => ({ i, o: Number(x.replace(/[^\d.]/g, "")) })).filter(({ i, o }) => i !== c.zone && i !== c.pitch && header[i]!.trim() !== "" && Number.isFinite(o));
    if (!orientCols.length) return { error: "No orientation columns found. Head them with degrees from south, e.g. 0, 5, 10 … 175." };
    for (const [i, r] of data.entries()) {
      const pitch = num(r[c.pitch!], "pitch", i + 2);
      if (isErr(pitch)) return pitch;
      for (const { i: col, o } of orientCols) {
        const kwh = num(r[col], `value for ${o}°`, i + 2);
        if (isErr(kwh)) return kwh;
        out.push({ zone: r[c.zone!]!.trim(), pitch, orientation: o, kwhPerKwp: kwh });
      }
    }
  }
  if (out.some((r) => r.orientation < 0 || r.orientation > 180)) return { error: "Orientation must be 0–180 degrees from south." };
  if (out.some((r) => r.kwhPerKwp <= 0)) return { error: "kWh/kWp values must be above zero." };
  return { rows: out };
}

export function parseZoneTable(rows: string[][]): Parsed<McsZoneRow> {
  const [header, ...data] = rows;
  if (!header || !data.length) return { error: "The file needs a header row and data." };
  const c = columns(header, ["postcode", "zone"]);
  if (isErr(c)) return c;
  const out = data.map((r) => ({ postcodePrefix: (r[c.postcode!] ?? "").trim().toUpperCase(), zone: (r[c.zone!] ?? "").trim() }));
  const bad = out.findIndex((r) => !/^[A-Z]{1,2}(\d[A-Z\d]?)?$/.test(r.postcodePrefix) || !r.zone);
  if (bad >= 0) return { error: `Line ${bad + 2}: "${out[bad]!.postcodePrefix}" isn't a postcode area or district.` };
  return { rows: out };
}

export function parseSelfConsumptionTable(rows: string[][]): Parsed<SelfConsumptionRow> {
  const [header, ...data] = rows;
  if (!header || !data.length) return { error: "The file needs a header row and data." };
  const c = columns(header, ["occupancy", "consumption_from_kwh", "generation_from_kwh", "battery_from_kwh", "fraction"]);
  if (isErr(c)) return c;
  const out: SelfConsumptionRow[] = [];
  for (const [i, r] of data.entries()) {
    const vals = (["consumption_from_kwh", "generation_from_kwh", "battery_from_kwh", "fraction"] as const).map((k) => num(r[c[k]!], k, i + 2));
    for (const v of vals) if (isErr(v)) return v;
    const [consumptionFromKwh, generationFromKwh, batteryFromKwh, fraction] = vals as number[];
    if (fraction! < 0 || fraction! > 1) return { error: `Line ${i + 2}: fraction must be between 0 and 1.` };
    out.push({ occupancy: r[c.occupancy!]!.trim(), consumptionFromKwh: consumptionFromKwh!, generationFromKwh: generationFromKwh!, batteryFromKwh: batteryFromKwh!, fraction: fraction! });
  }
  return { rows: out };
}

export function parseCableTable(rows: string[][]): Parsed<CableRow> {
  const [header, ...data] = rows;
  if (!header || !data.length) return { error: "The file needs a header row and data." };
  const c = columns(header, ["size_mm2", "method", "rating_a", "mv_per_am"]);
  if (isErr(c)) return c;
  const out: CableRow[] = [];
  for (const [i, r] of data.entries()) {
    const vals = (["size_mm2", "rating_a", "mv_per_am"] as const).map((k) => num(r[c[k]!], k, i + 2));
    for (const v of vals) if (isErr(v)) return v;
    const [sizeMm2, ratingA, mvPerAm] = vals as number[];
    const method = r[c.method!]?.trim();
    if (!method) return { error: `Line ${i + 2}: method is blank.` };
    out.push({ sizeMm2: sizeMm2!, method, ratingA: ratingA!, mvPerAm: mvPerAm! });
  }
  return { rows: out };
}

export const RULE_PARSERS: Record<RuleTableKind, (rows: string[][]) => Parsed<unknown>> = {
  mcs_yield: parseYieldTable,
  mcs_zones: parseZoneTable,
  self_consumption: parseSelfConsumptionTable,
  ev_cables: parseCableTable,
};

/** Company design settings (Settings › Design rules). All optional; calculations say what's missing. */
export interface DesignSettings {
  /** Minimum design temperature for string Voc, °C. */
  minDesignTempC?: number;
  /** Panel edge setback from roof edges, metres. */
  edgeSetbackM?: number;
  /** G98 per-phase limit, A (defaults to the ENA figure of 16 A). */
  g98LimitAPerPhase?: number;
  /** PVGIS system losses, %. */
  pvgisLossPct?: number;
  /** EV volt drop limit, % of nominal voltage. */
  evVoltDropLimitPct?: number;
  /** Diversity applied to the charger in maximum demand (1 = none). */
  evChargerDiversity?: number;
  /** Miles per kWh used for "EV miles from solar". */
  evMilesPerKwh?: number;
}

export const DESIGN_SETTING_FIELDS: { key: keyof DesignSettings; label: string; unit: string; help: string; min: number; max: number }[] = [
  { key: "edgeSetbackM", label: "Panel edge setback", unit: "m", help: "Gap kept clear between panels and roof edges or obstructions.", min: 0, max: 2 },
  { key: "minDesignTempC", label: "Minimum design temperature", unit: "°C", help: "Used to correct panel Voc when sizing strings.", min: -40, max: 10 },
  { key: "g98LimitAPerPhase", label: "G98 limit per phase", unit: "A", help: "Above this, a G99 application is needed. ENA G98 is 16 A.", min: 1, max: 100 },
  { key: "pvgisLossPct", label: "PVGIS system losses", unit: "%", help: "Used for the PVGIS cross-check only.", min: 0, max: 50 },
  { key: "evVoltDropLimitPct", label: "EV volt drop limit", unit: "%", help: "From your installation standard.", min: 0.5, max: 10 },
  { key: "evChargerDiversity", label: "Charger diversity in max demand", unit: "×", help: "1 means the charger's full current is added.", min: 0, max: 1 },
  { key: "evMilesPerKwh", label: "EV efficiency", unit: "miles per kWh", help: "For the 'EV miles from solar' figure.", min: 1, max: 6 },
];

export function parseDesignSettings(raw: Record<string, string | undefined>): { settings: DesignSettings } | { error: string } {
  const settings: DesignSettings = {};
  for (const f of DESIGN_SETTING_FIELDS) {
    const v = raw[f.key]?.trim();
    if (!v) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < f.min || n > f.max) return { error: `${f.label}: enter a number from ${f.min} to ${f.max}.` };
    settings[f.key] = n;
  }
  return { settings };
}
