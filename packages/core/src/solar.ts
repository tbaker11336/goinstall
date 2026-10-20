/**
 * Solar PV calculations. Rule values (MCS kWh/kWp tables, postcode zones,
 * design temperatures) are never built in: they come from tables and
 * settings the business uploads, passed in as arguments. Functions return
 * a `missing` reason instead of guessing when a table or value is absent.
 */

export type Missing = { ok: false; missing: string };
export type Result<T> = ({ ok: true } & T) | Missing;

const missing = (reason: string): Missing => ({ ok: false, missing: reason });

export function kWp(panelCount: number, panelWattsPeak: number): number {
  return Math.round(panelCount * panelWattsPeak) / 1000;
}

// ---------------------------------------------------------------------------
// MCS annual generation
// ---------------------------------------------------------------------------

/** One row of an MCS kWh/kWp table: generation per kWp for a zone, pitch and orientation. */
export interface McsYieldRow {
  zone: string;
  pitch: number;
  /** Degrees away from due south, 0 to 180 (east and west are both 90). */
  orientation: number;
  kwhPerKwp: number;
}

/** Postcode district (or area) to MCS zone, as supplied with the tables. */
export interface McsZoneRow {
  postcodePrefix: string;
  zone: string;
}

/** Degrees off south (0–180) from an azimuth in degrees clockwise from north. */
export function orientationFromAzimuth(azimuth: number): number {
  const a = ((azimuth % 360) + 360) % 360;
  return Math.abs(180 - a);
}

/** Outward code ("OX16") then area ("OX") lookups, longest match first. */
export function zoneForPostcode(postcode: string, zones: readonly McsZoneRow[]): string | null {
  const outward = postcode.trim().toUpperCase().split(/\s+/)[0] ?? "";
  if (!outward) return null;
  const byPrefix = new Map(zones.map((z) => [z.postcodePrefix.trim().toUpperCase(), z.zone]));
  const area = outward.match(/^[A-Z]+/)?.[0] ?? "";
  return byPrefix.get(outward) ?? byPrefix.get(area) ?? null;
}

/**
 * kWh per kWp for a roof, taking the table's nearest pitch and orientation
 * (the tables are published in steps; MCS uses the nearest entry).
 */
export function lookupKwhPerKwp(rows: readonly McsYieldRow[], zone: string, pitch: number, orientation: number): Result<{ kwhPerKwp: number; pitch: number; orientation: number }> {
  const inZone = rows.filter((r) => r.zone === zone);
  if (!inZone.length) return missing(`The MCS table has no rows for zone ${zone}.`);
  const nearest = (values: number[], target: number) => values.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best));
  const p = nearest([...new Set(inZone.map((r) => r.pitch))], pitch);
  const atPitch = inZone.filter((r) => r.pitch === p);
  const o = nearest([...new Set(atPitch.map((r) => r.orientation))], Math.min(180, Math.abs(orientation)));
  const row = atPitch.find((r) => r.orientation === o)!;
  return { ok: true, kwhPerKwp: row.kwhPerKwp, pitch: p, orientation: o };
}

export interface ArrayInput {
  id: string;
  panelCount: number;
  pitch: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** MCS shade factor, 0–1 (1 = unshaded). */
  shadeFactor: number;
}

export interface ArrayYield {
  id: string;
  kWp: number;
  kwhPerKwp: number;
  shadeFactor: number;
  annualKwh: number;
}

/**
 * MCS annual generation: per array, kWp × kWh/kWp (zone, pitch, orientation)
 * × shade factor. The system figure is the sum of the arrays.
 */
export function mcsAnnualGeneration(
  arrays: readonly ArrayInput[],
  panelWattsPeak: number,
  postcode: string,
  tables: { yields: readonly McsYieldRow[]; zones: readonly McsZoneRow[] } | null,
): Result<{ zone: string; arrays: ArrayYield[]; annualKwh: number; kWp: number }> {
  if (!tables?.yields.length || !tables.zones.length) return missing("Upload the MCS kWh/kWp and postcode zone tables in Settings › Design rules.");
  if (!panelWattsPeak) return missing("Choose a panel with its peak power (Wp) filled in.");
  const zone = zoneForPostcode(postcode, tables.zones);
  if (!zone) return missing(`No MCS zone for postcode ${postcode || "(none)"}. Check the site postcode or the zone table.`);
  const out: ArrayYield[] = [];
  for (const a of arrays) {
    if (a.panelCount <= 0) continue;
    if (!(a.shadeFactor > 0 && a.shadeFactor <= 1)) return missing(`Roof ${a.id}: shade factor must be between 0 and 1.`);
    const lookup = lookupKwhPerKwp(tables.yields, zone, a.pitch, orientationFromAzimuth(a.azimuth));
    if (!lookup.ok) return lookup;
    const size = kWp(a.panelCount, panelWattsPeak);
    // MCS rounds each array's figure down to the nearest whole kWh.
    out.push({ id: a.id, kWp: size, kwhPerKwp: lookup.kwhPerKwp, shadeFactor: a.shadeFactor, annualKwh: Math.floor(size * lookup.kwhPerKwp * a.shadeFactor) });
  }
  return {
    ok: true,
    zone,
    arrays: out,
    annualKwh: out.reduce((n, a) => n + a.annualKwh, 0),
    kWp: Math.round(out.reduce((n, a) => n + a.kWp, 0) * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Inverter matching and string sizing (from datasheet values)
// ---------------------------------------------------------------------------

export interface PanelSpecs {
  watts_peak?: number;
  voc?: number;
  vmp?: number;
  isc?: number;
  imp?: number;
  /** Percent per °C, negative (e.g. -0.25). */
  temp_coeff_voc?: number;
}

export interface InverterSpecs {
  ac_kw?: number;
  max_dc_kw?: number;
  mppt_count?: number;
  mppt_min_v?: number;
  mppt_max_v?: number;
  max_input_v?: number;
  max_input_a?: number;
  hybrid?: boolean;
  phases?: number;
}

export function dcAcRatio(arrayKwp: number, inverterAcKw: number): number | null {
  return inverterAcKw > 0 ? Math.round((arrayKwp / inverterAcKw) * 100) / 100 : null;
}

/**
 * Pick an inverter for an array: the smallest AC rating whose datasheet
 * maximum DC input covers the array, hybrid first when there's a battery.
 */
export function matchInverter<I extends { id: string; specs: InverterSpecs }>(inverters: readonly I[], arrayKwp: number, opts: { battery?: boolean } = {}): I | null {
  const fits = inverters.filter((i) => (i.specs.ac_kw ?? 0) > 0 && (i.specs.max_dc_kw ?? 0) >= arrayKwp);
  const pool = opts.battery && fits.some((i) => i.specs.hybrid) ? fits.filter((i) => i.specs.hybrid) : fits;
  return [...pool].sort((a, b) => a.specs.ac_kw! - b.specs.ac_kw!)[0] ?? null;
}

/**
 * Panels per string allowed by the inverter. The maximum uses Voc corrected
 * to the company's minimum design temperature; without that setting (or the
 * panel's temperature coefficient) Voc is used uncorrected and flagged.
 */
export function stringLimits(
  panel: PanelSpecs,
  inverter: InverterSpecs,
  settings: { minDesignTempC?: number | null },
): Result<{ minPerString: number; maxPerString: number; vocCorrected: boolean }> {
  if (!panel.voc || !panel.vmp) return missing("The panel needs Voc and Vmp in its datasheet values.");
  if (!inverter.max_input_v || !inverter.mppt_min_v) return missing("The inverter needs its max input voltage and MPPT range.");
  const corrected = settings.minDesignTempC != null && panel.temp_coeff_voc != null;
  const vocCold = corrected ? panel.voc * (1 + (panel.temp_coeff_voc! / 100) * (settings.minDesignTempC! - 25)) : panel.voc;
  const maxPerString = Math.floor(inverter.max_input_v / vocCold);
  const minPerString = Math.ceil(inverter.mppt_min_v / panel.vmp);
  if (maxPerString < minPerString) return missing("This panel and inverter can't make a valid string.");
  return { ok: true, minPerString, maxPerString, vocCorrected: corrected };
}

/**
 * Split panels into strings across MPPT inputs as evenly as possible, each
 * within the per-string limits. Returns the panel count per string.
 */
export function layoutStrings(panelCount: number, limits: { minPerString: number; maxPerString: number }, mpptCount: number): Result<{ strings: number[] }> {
  if (panelCount <= 0) return { ok: true, strings: [] };
  const inputs = Math.max(1, mpptCount);
  for (let n = 1; n <= inputs; n++) {
    const base = Math.floor(panelCount / n);
    const extra = panelCount % n;
    const strings = Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
    if (strings.every((s) => s >= limits.minPerString && s <= limits.maxPerString)) return { ok: true, strings };
  }
  return missing(`${panelCount} panels don't fit ${inputs} string${inputs === 1 ? "" : "s"} of ${limits.minPerString}–${limits.maxPerString} panels. Add an inverter input or change the panel count.`);
}

// ---------------------------------------------------------------------------
// G98 / G99
// ---------------------------------------------------------------------------

/**
 * ENA Engineering Recommendation G98 covers microgeneration up to 16 A per
 * phase; above that a G99 application is needed before install. Kept as a
 * default the company can change in settings if its DNO guidance differs.
 */
export const G98_DEFAULT_LIMIT_A_PER_PHASE = 16;

export function exportCapacityKw(inverters: readonly { acKw: number }[], exportLimitKw?: number | null): number {
  const total = inverters.reduce((n, i) => n + i.acKw, 0);
  return exportLimitKw != null ? Math.min(total, exportLimitKw) : total;
}

/** Which notification the DNO needs, from the installation's export capacity. */
export function connectionApplication(exportKw: number, phases: 1 | 3, opts: { limitAPerPhase?: number; nominalV?: number } = {}): { form: "G98" | "G99"; thresholdKw: number } {
  const amps = opts.limitAPerPhase ?? G98_DEFAULT_LIMIT_A_PER_PHASE;
  const v = opts.nominalV ?? 230;
  const thresholdKw = Math.round(((amps * v * phases) / 1000) * 100) / 100;
  return { form: exportKw > thresholdKw ? "G99" : "G98", thresholdKw };
}

// ---------------------------------------------------------------------------
// Self-consumption (MCS occupancy archetypes; table supplied by the business)
// ---------------------------------------------------------------------------

export interface SelfConsumptionRow {
  occupancy: string;
  /** Lower bound of the annual consumption band, kWh. */
  consumptionFromKwh: number;
  /** Lower bound of the PV generation band, kWh. */
  generationFromKwh: number;
  /** Lower bound of the usable battery band, kWh (0 = no battery). */
  batteryFromKwh: number;
  fraction: number;
}

/** Fraction of generation used on site, from the band each value falls in. */
export function selfConsumption(
  rows: readonly SelfConsumptionRow[] | null,
  input: { occupancy: string | null; consumptionKwh: number | null; generationKwh: number; batteryKwh: number },
): Result<{ fraction: number }> {
  if (!rows?.length) return missing("Upload the MCS self-consumption table in Settings › Design rules.");
  if (!input.occupancy) return missing("Add the occupancy from the survey.");
  if (!input.consumptionKwh) return missing("Add the annual electricity use from the survey.");
  const band = (values: number[], v: number) => values.filter((x) => x <= v).reduce((a, b) => Math.max(a, b), -Infinity);
  const set = rows.filter((r) => r.occupancy.toLowerCase() === input.occupancy!.toLowerCase());
  if (!set.length) return missing(`The self-consumption table has no rows for "${input.occupancy}".`);
  const c = band([...new Set(set.map((r) => r.consumptionFromKwh))], input.consumptionKwh);
  const g = band([...new Set(set.filter((r) => r.consumptionFromKwh === c).map((r) => r.generationFromKwh))], input.generationKwh);
  const b = band([...new Set(set.filter((r) => r.consumptionFromKwh === c && r.generationFromKwh === g).map((r) => r.batteryFromKwh))], input.batteryKwh);
  const row = set.find((r) => r.consumptionFromKwh === c && r.generationFromKwh === g && r.batteryFromKwh === b);
  return row ? { ok: true, fraction: row.fraction } : missing("No matching band in the self-consumption table.");
}

// ---------------------------------------------------------------------------
// Panel layout on a roof segment
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

/** Point-in-polygon (ray casting); coordinates in metres on the roof plane. */
export function insidePolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when a rectangle sits inside the polygon with at least `setback` metres to every edge. */
export function rectFits(rect: { x: number; y: number; w: number; h: number }, polygon: readonly Point[], setback: number): boolean {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  if (!corners.every((c) => insidePolygon(c, polygon))) return false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    if (corners.some((c) => distanceToSegment(c, a, b) < setback - 1e-9)) return false;
  }
  return true;
}

export interface Obstruction {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Obstruction, b: Obstruction, gap: number) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/**
 * Auto-fill a roof segment with panels in rows, keeping the edge setback and
 * clear of obstructions (with the same setback). Coordinates are metres on
 * the roof plane, y down-slope. Panel size in metres; landscape swaps them.
 */
export function autoFill(
  polygon: readonly Point[],
  panel: { width: number; height: number },
  opts: { setback: number; gap?: number; landscape?: boolean; obstructions?: readonly Obstruction[]; max?: number },
): { x: number; y: number; w: number; h: number }[] {
  if (polygon.length < 3) return [];
  const w = opts.landscape ? panel.height : panel.width;
  const h = opts.landscape ? panel.width : panel.height;
  const gap = opts.gap ?? 0.02;
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = minY + opts.setback; y + h <= maxY - opts.setback + 1e-9; y += h + gap) {
    // Centre each row: find the fitting run, then shift it to the middle.
    const row: { x: number; y: number; w: number; h: number }[] = [];
    for (let x = minX + opts.setback; x + w <= maxX - opts.setback + 1e-9; x += 0.05) {
      const r = { x, y, w, h };
      if (!rectFits(r, polygon, opts.setback)) continue;
      if (opts.obstructions?.some((o) => overlaps(r, o, opts.setback))) continue;
      if (row.length && x < row[row.length - 1]!.x + w + gap - 1e-9) continue;
      row.push(r);
    }
    placed.push(...row);
    if (opts.max && placed.length >= opts.max) return placed.slice(0, opts.max);
  }
  return placed;
}
