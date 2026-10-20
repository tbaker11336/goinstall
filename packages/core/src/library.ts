/**
 * The shared product library: datasheet values from public lists that every
 * company can copy into its own catalogue. Panels come from the California
 * Energy Commission PV module list as published in NREL's System Advisor
 * Model (SAM) library ("CEC Modules.csv").
 */
import { parseCsv, type Specs } from "./catalogue";

export interface LibraryProduct {
  category: "panel" | "inverter" | "battery";
  make: string;
  model: string;
  /** Name used on proposals when copied into a catalogue. */
  name: string;
  specs: Specs;
}

export const LIBRARY_SOURCES = {
  cec: "California Energy Commission PV module list, via the NREL System Advisor Model library",
} as const;
export type LibrarySource = keyof typeof LIBRARY_SOURCES;

const SUFFIX = /[\s,.]+(co\.?,?\s*ltd\.?|company\s+limited|limited|ltd\.?|inc\.?|llc|corp(oration)?\.?|gmbh|s\.?a\.?|plc|pte\.?|co\.?)$/i;

/** "Jinko Solar Co., Ltd." → "Jinko Solar": the maker as people say it. */
export function shortMake(manufacturer: string): string {
  let m = manufacturer.trim();
  for (let i = 0; i < 3 && SUFFIX.test(m); i++) m = m.replace(SUFFIX, "").trim();
  return m || manufacturer.trim();
}

const num = (v: string | undefined) => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Panels from SAM's "CEC Modules.csv": three header rows (names, units, SAM
 * keys), then one module per row. Rows without a nameplate power, Voc or Vmp
 * are skipped; values the list doesn't give (often dimensions) are left out.
 */
export function parseCecModules(csv: string): { products: LibraryProduct[]; version: string | null; skipped: number } {
  const rows = parseCsv(csv);
  const head = rows[0] ?? [];
  const col = (name: string) => head.indexOf(name);
  const c = { name: col("Name"), make: col("Manufacturer"), tech: col("Technology"), bifacial: col("Bifacial"), stc: col("STC"), length: col("Length"), width: col("Width"), isc: col("I_sc_ref"), voc: col("V_oc_ref"), imp: col("I_mp_ref"), vmp: col("V_mp_ref"), beta: col("beta_oc"), version: col("Version") };
  if (Object.values(c).some((i) => i < 0)) throw new Error("Not a SAM CEC module library: expected columns are missing.");
  const seen = new Set<string>();
  const products: LibraryProduct[] = [];
  let skipped = 0;
  let version: string | null = null;
  for (const r of rows.slice(3)) {
    const manufacturer = r[c.make]?.trim() ?? "";
    const full = r[c.name]?.trim() ?? "";
    const stc = num(r[c.stc]);
    const voc = num(r[c.voc]);
    const vmp = num(r[c.vmp]);
    if (!manufacturer || !full || !stc || !voc || !vmp) {
      skipped++;
      continue;
    }
    version ??= r[c.version]?.trim() || null;
    const model = (full.startsWith(manufacturer) ? full.slice(manufacturer.length) : full).trim() || full;
    const key = `${manufacturer}|${model}`.toLowerCase();
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const make = shortMake(manufacturer);
    const specs: Specs = { watts_peak: round(stc, 1), voc: round(voc, 2), vmp: round(vmp, 2) };
    const isc = num(r[c.isc]);
    const imp = num(r[c.imp]);
    const beta = num(r[c.beta]);
    const length = num(r[c.length]);
    const width = num(r[c.width]);
    if (isc) specs.isc = round(isc, 2);
    if (imp) specs.imp = round(imp, 2);
    // SAM gives β(Voc) in V/K; the catalogue uses %/°C.
    if (beta !== null) specs.temp_coeff_voc = round((beta / voc) * 100, 3);
    // Length is the long side (height on the roof in portrait).
    if (length && width) {
      specs.height_mm = Math.round(Math.max(length, width) * 1000);
      specs.width_mm = Math.round(Math.min(length, width) * 1000);
    }
    products.push({ category: "panel", make, model, name: `${make} ${model} ${Math.round(stc)} W`, specs });
  }
  return { products, version, skipped };
}
