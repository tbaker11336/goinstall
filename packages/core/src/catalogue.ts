/**
 * Product catalogue rules: CSV price files, money in pence, product specs by
 * category, and choosing a supplier for a kit line.
 */

export const PRODUCT_CATEGORIES = ["panel", "inverter", "battery", "ev_charger", "mounting", "cable", "electrical", "labour", "other"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  panel: "Panel",
  inverter: "Inverter",
  battery: "Battery",
  ev_charger: "EV charger",
  mounting: "Mounting",
  cable: "Cable",
  electrical: "Electrical",
  labour: "Labour",
  other: "Other",
};

export interface SpecField {
  key: string;
  label: string;
  unit?: string;
  type: "number" | "boolean" | "text";
}

/**
 * Datasheet values the calculations read, per category. These are fields to
 * fill from manufacturers' datasheets, not rule values.
 */
export const SPEC_FIELDS: Partial<Record<ProductCategory, SpecField[]>> = {
  panel: [
    { key: "watts_peak", label: "Peak power", unit: "Wp", type: "number" },
    { key: "width_mm", label: "Width", unit: "mm", type: "number" },
    { key: "height_mm", label: "Height", unit: "mm", type: "number" },
    { key: "voc", label: "Open-circuit voltage (Voc)", unit: "V", type: "number" },
    { key: "isc", label: "Short-circuit current (Isc)", unit: "A", type: "number" },
    { key: "vmp", label: "Voltage at max power (Vmp)", unit: "V", type: "number" },
    { key: "imp", label: "Current at max power (Imp)", unit: "A", type: "number" },
    { key: "temp_coeff_voc", label: "Voc temperature coefficient", unit: "%/°C", type: "number" },
  ],
  inverter: [
    { key: "ac_kw", label: "AC output", unit: "kW", type: "number" },
    { key: "max_dc_kw", label: "Max DC input", unit: "kW", type: "number" },
    { key: "mppt_count", label: "MPPT inputs", type: "number" },
    { key: "mppt_min_v", label: "MPPT range from", unit: "V", type: "number" },
    { key: "mppt_max_v", label: "MPPT range to", unit: "V", type: "number" },
    { key: "max_input_v", label: "Max input voltage", unit: "V", type: "number" },
    { key: "max_input_a", label: "Max input current per MPPT", unit: "A", type: "number" },
    { key: "hybrid", label: "Hybrid (battery-ready)", type: "boolean" },
    { key: "phases", label: "Phases", type: "number" },
  ],
  battery: [
    { key: "capacity_kwh", label: "Capacity", unit: "kWh", type: "number" },
    { key: "usable_kwh", label: "Usable capacity", unit: "kWh", type: "number" },
    { key: "power_kw", label: "Continuous power", unit: "kW", type: "number" },
  ],
  ev_charger: [
    { key: "rated_kw", label: "Rated power", unit: "kW", type: "number" },
    { key: "rated_a", label: "Rated current", unit: "A", type: "number" },
    { key: "phases", label: "Phases", type: "number" },
    { key: "tethered", label: "Tethered", type: "boolean" },
    { key: "solar_divert", label: "Solar divert mode", type: "boolean" },
    { key: "pen_protection", label: "Built-in PEN fault protection", type: "boolean" },
  ],
};

export type Specs = Record<string, number | boolean | string>;

/** Read spec inputs (strings from a form or CSV) into typed values, dropping blanks. */
export function parseSpecs(category: ProductCategory, raw: Record<string, string | undefined>): { specs: Specs } | { error: string } {
  const specs: Specs = {};
  for (const f of SPEC_FIELDS[category] ?? []) {
    const v = raw[f.key]?.trim();
    if (!v) continue;
    if (f.type === "number") {
      const n = Number(v.replace(/,/g, ""));
      if (!Number.isFinite(n)) return { error: `${f.label}: enter a number` };
      specs[f.key] = n;
    } else if (f.type === "boolean") {
      specs[f.key] = /^(y|yes|true|1|on)$/i.test(v);
    } else specs[f.key] = v;
  }
  return { specs };
}

/** "£1,234.50", "1234.5", "1,234" -> 123450. Returns null for blank, NaN for nonsense. */
export function parsePence(raw: string | null | undefined): number | null {
  const v = (raw ?? "").replace(/[£,\s]/g, "").replace(/^GBP/i, "");
  if (v === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return Number.NaN;
  const [whole, frac = ""] = v.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatPence(pence: number | null | undefined): string {
  if (pence === null || pence === undefined) return "—";
  const pounds = pence / 100;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(pounds);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF), also accepting ; or tab separators. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].reduce((best, s) => (firstLine.split(s).length > firstLine.split(best).length ? s : best), ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ""));
}

/** Fields a price file can fill. */
export const IMPORT_FIELDS = [
  { key: "name", label: "Product name", required: false },
  { key: "make", label: "Make", required: false },
  { key: "model", label: "Model", required: true },
  { key: "category", label: "Category", required: false },
  { key: "supplier_sku", label: "Supplier code (SKU)", required: false },
  { key: "cost", label: "Cost price", required: false },
  { key: "sell", label: "Sell price", required: false },
  { key: "stock", label: "Stock", required: false },
  { key: "lead_time_days", label: "Lead time (days)", required: false },
  { key: "watts_peak", label: "Panel watts (Wp)", required: false },
  { key: "capacity_kwh", label: "Battery capacity (kWh)", required: false },
  { key: "ac_kw", label: "Inverter AC output (kW)", required: false },
  { key: "rated_kw", label: "Charger rating (kW)", required: false },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
export type ColumnMapping = Partial<Record<ImportField, number>>;

const HEADER_HINTS: Record<ImportField, RegExp> = {
  name: /^(product\s*)?(name|description|desc|title)$/i,
  make: /^(make|brand|manufacturer|mfr)$/i,
  model: /^(model|model\s*(no|number|code)|part\s*(no|number))$/i,
  category: /^(category|type|product\s*type|group)$/i,
  supplier_sku: /^(sku|code|product\s*code|item\s*code|supplier\s*(code|sku)|stock\s*code)$/i,
  cost: /^(cost|cost\s*price|trade(\s*price)?|net(\s*price)?|price|buy(\s*price)?|unit\s*price)(\s*\(?(ex\.?\s*vat|£|gbp)\)?)?$/i,
  sell: /^(sell|sell\s*price|rrp|retail(\s*price)?|list\s*price)(\s*\(?(ex\.?\s*vat|£|gbp)\)?)?$/i,
  stock: /^(stock|qty|quantity|available|in\s*stock|stock\s*level|free\s*stock)$/i,
  lead_time_days: /^(lead\s*time|lead\s*time\s*\(?days\)?|delivery\s*days)$/i,
  watts_peak: /^(wp|watts?|power\s*\(?wp\)?|peak\s*power)$/i,
  capacity_kwh: /^(kwh|capacity(\s*\(?kwh\)?)?)$/i,
  ac_kw: /^(ac\s*kw|ac\s*output|inverter\s*kw)$/i,
  rated_kw: /^(charger\s*kw|rated\s*kw|kw)$/i,
};

/** First-guess column mapping from the header row; staff confirm or change it. */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const f of IMPORT_FIELDS) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && HEADER_HINTS[f.key].test(h.trim()));
    if (i >= 0) {
      mapping[f.key] = i;
      used.add(i);
    }
  }
  return mapping;
}

const CATEGORY_WORDS: [RegExp, ProductCategory][] = [
  [/panel|module|pv\b/i, "panel"],
  [/inverter/i, "inverter"],
  [/batter/i, "battery"],
  [/charger|ev\b|evse/i, "ev_charger"],
  [/mount|rail|hook|bracket|roof\s*kit/i, "mounting"],
  [/cable|swa|wire/i, "cable"],
  [/isolator|breaker|rcbo|rcd|mcb|consumer|meter|electrical|switch/i, "electrical"],
  [/labour|install/i, "labour"],
];

export function guessCategory(...texts: (string | undefined)[]): ProductCategory {
  const t = texts.filter(Boolean).join(" ");
  const exact = PRODUCT_CATEGORIES.find((c) => c === t.trim().toLowerCase().replace(/\s+/g, "_") || CATEGORY_LABELS[c].toLowerCase() === t.trim().toLowerCase());
  if (exact) return exact;
  return CATEGORY_WORDS.find(([re]) => re.test(t))?.[1] ?? "other";
}

export interface ImportRow {
  line: number;
  name: string;
  make: string | null;
  model: string;
  category: ProductCategory;
  supplierSku: string | null;
  costPence: number | null;
  sellPence: number | null;
  stockQty: number | null;
  leadTimeDays: number | null;
  specs: Specs;
}

export interface ImportPreview {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
}

/** Apply a mapping to data rows (header excluded). Line numbers count the header as line 1. */
export function mapImportRows(dataRows: string[][], mapping: ColumnMapping): ImportPreview {
  const rows: ImportRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const get = (r: string[], k: ImportField) => (mapping[k] === undefined ? undefined : r[mapping[k]!]?.trim() || undefined);
  const int = (v: string | undefined) => {
    if (v === undefined) return null;
    if (/^(yes|in\s*stock|y)$/i.test(v)) return null;
    const n = Number(v.replace(/,/g, ""));
    return Number.isInteger(n) && n >= 0 ? n : Number.NaN;
  };
  dataRows.forEach((r, i) => {
    const line = i + 2;
    const model = get(r, "model") ?? get(r, "supplier_sku");
    if (!model) return errors.push({ line, message: "No model or supplier code" });
    const costPence = parsePence(get(r, "cost"));
    const sellPence = parsePence(get(r, "sell"));
    if (Number.isNaN(costPence)) return errors.push({ line, message: `Cost "${get(r, "cost")}" isn't a price` });
    if (Number.isNaN(sellPence)) return errors.push({ line, message: `Sell price "${get(r, "sell")}" isn't a price` });
    const stockQty = int(get(r, "stock"));
    const leadTimeDays = int(get(r, "lead_time_days"));
    if (Number.isNaN(stockQty)) return errors.push({ line, message: `Stock "${get(r, "stock")}" isn't a whole number` });
    if (Number.isNaN(leadTimeDays)) return errors.push({ line, message: `Lead time "${get(r, "lead_time_days")}" isn't a whole number of days` });
    const make = get(r, "make") ?? null;
    const name = get(r, "name") ?? [make, model].filter(Boolean).join(" ");
    const category = guessCategory(get(r, "category"), name);
    const parsed = parseSpecs(category, {
      watts_peak: get(r, "watts_peak"),
      capacity_kwh: get(r, "capacity_kwh"),
      ac_kw: get(r, "ac_kw"),
      rated_kw: get(r, "rated_kw"),
    });
    if ("error" in parsed) return errors.push({ line, message: parsed.error });
    rows.push({ line, name, make, model, category, supplierSku: get(r, "supplier_sku") ?? null, costPence, sellPence, stockQty, leadTimeDays, specs: parsed.specs });
  });
  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Supplier choice
// ---------------------------------------------------------------------------

export interface SupplierOffer {
  supplierId: string;
  costPence: number | null;
  stockQty: number | null;
  leadTimeDays: number | null;
}

/** In stock when stock covers the quantity, or the supplier reports no stock but no lead time either. */
export function inStock(o: SupplierOffer, qty = 1) {
  return o.stockQty !== null ? o.stockQty >= qty : o.leadTimeDays === null || o.leadTimeDays === 0;
}

/** Default kit selection: cheapest in stock; otherwise cheapest overall, then shortest lead time. */
export function bestOffer<O extends SupplierOffer>(offers: readonly O[], qty = 1): O | null {
  const priced = offers.filter((o) => o.costPence !== null);
  if (!priced.length) return null;
  const pool = priced.some((o) => inStock(o, qty)) ? priced.filter((o) => inStock(o, qty)) : priced;
  return [...pool].sort((a, b) => a.costPence! - b.costPence! || (a.leadTimeDays ?? 0) - (b.leadTimeDays ?? 0))[0]!;
}

/** Margin of a sell price over a cost, as a fraction (0.366 = 36.6%). */
export function margin(sellPence: number, costPence: number): number | null {
  return sellPence > 0 ? (sellPence - costPence) / sellPence : null;
}
