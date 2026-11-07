/**
 * Electrical test results: the schedule of circuit details and test
 * results for each distribution board, as on the electrician's
 * certificate (EIC continuation sheet). Values are what the installer
 * writes on the sheet, so they're kept as text (">200", "N/A", "LIM" are
 * all normal). Nothing is pre-filled.
 */

export interface TestField {
  key: string;
  label: string;
  /** Column heading on the schedule. */
  short: string;
  unit?: string;
  group: string;
  /** Polarity is a tick or a cross; the rest are free text. */
  options?: readonly string[];
}

export const BOARD_FIELDS: readonly TestField[] = [
  { key: "db_ref", label: "DB reference", short: "DB ref", group: "Board" },
  { key: "location", label: "Distribution board location", short: "Location", group: "Board" },
  { key: "supplied_from", label: "Supplied from", short: "Supplied from", group: "Board" },
  { key: "phases", label: "Number of phases", short: "Phases", group: "Board" },
  { key: "zdb", label: "Zdb at this board", short: "Zdb", unit: "Ω", group: "Board" },
  { key: "ipf", label: "Ipf at this board", short: "Ipf", unit: "kA", group: "Board" },
  { key: "main_switch_bsen", label: "Main switch type (BS EN)", short: "Main switch BS EN", group: "Main switch" },
  { key: "main_switch_rating", label: "Main switch rating", short: "Rating", unit: "A", group: "Main switch" },
  { key: "supply_conductors", label: "Supply conductors", short: "Supply conductors", unit: "mm²", group: "Main switch" },
  { key: "earth_conductor", label: "Earth conductor", short: "Earth", unit: "mm²", group: "Main switch" },
  { key: "spd_bsen", label: "Supply protective device type (BS EN)", short: "Supply device BS EN", group: "Supply protective device" },
  { key: "spd_rating", label: "Supply protective device rating", short: "Rating", unit: "A", group: "Supply protective device" },
];

export const CIRCUIT_FIELDS: readonly TestField[] = [
  { key: "ref", label: "Circuit reference", short: "Ref", group: "Circuit details" },
  { key: "designation", label: "Circuit designation", short: "Designation", group: "Circuit details" },
  { key: "wiring_type", label: "Type of wiring", short: "Wiring", group: "Circuit details" },
  { key: "ref_method", label: "Reference method", short: "Ref method", group: "Circuit details" },
  { key: "points", label: "Number of points served", short: "Points", group: "Circuit details" },
  { key: "live_mm2", label: "Live conductor", short: "Live", unit: "mm²", group: "Circuit details" },
  { key: "cpc_mm2", label: "cpc", short: "cpc", unit: "mm²", group: "Circuit details" },
  { key: "max_disconnect_s", label: "Max. disconnection time permitted", short: "Max disc.", unit: "s", group: "Circuit details" },
  { key: "ocpd_bsen", label: "Overcurrent device type (BS EN)", short: "BS EN", group: "Overcurrent device" },
  { key: "ocpd_rating", label: "Overcurrent device rating", short: "Rating", unit: "A", group: "Overcurrent device" },
  { key: "ocpd_ka", label: "Short circuit capacity", short: "kA", unit: "kA", group: "Overcurrent device" },
  { key: "rcd_idn", label: "RCD IΔn", short: "IΔn", unit: "mA", group: "Overcurrent device" },
  { key: "max_zs", label: "Maximum permitted Zs", short: "Max Zs", unit: "Ω", group: "Overcurrent device" },
  { key: "r1", label: "Ring final: r1 (end to end)", short: "r1", unit: "Ω", group: "Ring final circuits" },
  { key: "rn", label: "Ring final: rn (end to end)", short: "rn", unit: "Ω", group: "Ring final circuits" },
  { key: "r2", label: "Ring final: r2 (end to end)", short: "r2", unit: "Ω", group: "Ring final circuits" },
  { key: "r1_r2", label: "R1 + R2", short: "R1+R2", unit: "Ω", group: "All circuits (one column at least)" },
  { key: "r2_all", label: "R2", short: "R2", unit: "Ω", group: "All circuits (one column at least)" },
  { key: "ir_pp", label: "Insulation resistance: phase/phase", short: "P/P", unit: "MΩ", group: "Insulation resistance" },
  { key: "ir_pn", label: "Insulation resistance: phase/neutral", short: "P/N", unit: "MΩ", group: "Insulation resistance" },
  { key: "ir_pe", label: "Insulation resistance: phase/earth", short: "P/E", unit: "MΩ", group: "Insulation resistance" },
  { key: "ir_ne", label: "Insulation resistance: neutral/earth", short: "N/E", unit: "MΩ", group: "Insulation resistance" },
  { key: "polarity", label: "Polarity", short: "Polarity", group: "Polarity and Zs", options: ["✓", "✗", "N/A"] },
  { key: "zs", label: "Maximum measured Zs", short: "Zs", unit: "Ω", group: "Polarity and Zs" },
  { key: "rcd_ms", label: "RCD at IΔn", short: "@IΔn", unit: "ms", group: "RCD" },
  { key: "rcd_5x_ms", label: "RCD at 5 × IΔn", short: "@5IΔn", unit: "ms", group: "RCD" },
];

export type TestValues = Record<string, string>;

export interface TestBoard {
  board: TestValues;
  circuits: TestValues[];
}

export const MAX_CIRCUITS = 100;
const MAX_VALUE = 120;

function clean(fields: readonly TestField[], raw: Record<string, unknown> | null | undefined): TestValues {
  const out: TestValues = {};
  for (const f of fields) {
    const v = raw?.[f.key];
    if (typeof v !== "string" && typeof v !== "number") continue;
    const s = String(v).trim().slice(0, f.key === "designation" || f.key === "location" ? MAX_VALUE : 40);
    if (s) out[f.key] = s;
  }
  return out;
}

/** Keep only the known fields, trimmed; drop circuit rows left completely empty. */
export function cleanTestBoard(raw: { board?: Record<string, unknown> | null; circuits?: (Record<string, unknown> | null)[] | null }): TestBoard {
  const circuits = (raw.circuits ?? []).map((c) => clean(CIRCUIT_FIELDS, c)).filter((c) => Object.keys(c).length > 0);
  return { board: clean(BOARD_FIELDS, raw.board), circuits: circuits.slice(0, MAX_CIRCUITS) };
}

const num = (v: string | undefined) => {
  if (!v) return null;
  const n = Number(v.replace(/[^\d.]/g, ""));
  return /^[<>]/.test(v.trim()) || !Number.isFinite(n) || v.replace(/[^\d.]/g, "") === "" ? null : n;
};

/**
 * Things to look at again, from the values written on the sheet itself:
 * a measured Zs above the permitted Zs written for that circuit, a
 * polarity cross, and circuits with no test results at all.
 */
export function circuitWarnings(c: TestValues): string[] {
  const out: string[] = [];
  const zs = num(c.zs);
  const max = num(c.max_zs);
  if (zs !== null && max !== null && zs > max) out.push(`Measured Zs ${c.zs} Ω is above the permitted ${c.max_zs} Ω`);
  if (c.polarity === "✗") out.push("Polarity marked incorrect");
  const results = CIRCUIT_FIELDS.slice(CIRCUIT_FIELDS.findIndex((f) => f.key === "r1"));
  if (!results.some((f) => c[f.key])) out.push("No test results yet");
  return out;
}

/** A short title for a board: "DB1 · Garage". */
export function boardTitle(b: TestValues, index: number): string {
  return [b.db_ref || `Board ${index + 1}`, b.location].filter(Boolean).join(" · ");
}

/** Column groups in order, for drawing the schedule's two-row heading. */
export function circuitGroups(): { group: string; fields: TestField[] }[] {
  const out: { group: string; fields: TestField[] }[] = [];
  for (const f of CIRCUIT_FIELDS) {
    const last = out.at(-1);
    if (last?.group === f.group) last.fields.push(f);
    else out.push({ group: f.group, fields: [f] });
  }
  return out;
}
