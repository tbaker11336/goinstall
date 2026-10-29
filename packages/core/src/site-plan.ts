/**
 * Site plan markup and electrical layout drawn in the solar designer: panels
 * dragged onto a roof, panels wired into strings, cable routes, measurements
 * and equipment markers, and the model behind the single line diagram.
 * Plan coordinates are metres east (x) and south (y) of the site centre.
 */
import { insidePolygon, layoutStrings, rectFits, stringLimits, type InverterSpecs, type Obstruction, type PanelSpecs, type Point } from "./solar";

/** A placed panel on a roof plane; `s` is its string number (1-based) once wired. */
export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
  s?: number | null;
}

export const MARKER_KINDS = ["meter_box", "distribution_board", "ev_charger", "battery", "inverter", "scaffold", "note"] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];
export const MARKER_LABELS: Record<MarkerKind, string> = {
  meter_box: "Meter box",
  distribution_board: "Distribution board",
  ev_charger: "EV charger",
  battery: "Battery",
  inverter: "Inverter",
  scaffold: "Scaffold / access",
  note: "Note",
};
/** Short codes drawn on the plan. */
export const MARKER_CODES: Record<MarkerKind, string> = { meter_box: "M", distribution_board: "DB", ev_charger: "EV", battery: "B", inverter: "INV", scaffold: "S", note: "!" };

export const CABLE_KINDS = ["dc", "ac", "battery", "ev", "data"] as const;
export type CableKind = (typeof CABLE_KINDS)[number];
export const CABLE_LABELS: Record<CableKind, string> = { dc: "DC (PV)", ac: "AC", battery: "Battery", ev: "EV supply", data: "Data / CT" };

export interface SiteMarker {
  id: string;
  kind: MarkerKind;
  x: number;
  y: number;
  note: string;
}

export interface CableRun {
  id: string;
  kind: CableKind;
  points: Point[];
  /** Metres not visible on the plan: drops down walls, loops, into the loft. */
  extraM: number;
  label: string;
}

export interface Measurement {
  id: string;
  a: Point;
  b: Point;
}

export interface SiteMarkup {
  markers: SiteMarker[];
  cables: CableRun[];
  measurements: Measurement[];
}

export const EMPTY_MARKUP: SiteMarkup = { markers: [], cables: [], measurements: [] };

/** Which MPPT input each string goes to; index is string number − 1. */
export interface StringPlan {
  strings: { mppt: number }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Plan length of a polyline, metres. */
export function polylineLength(points: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += distance(points[i - 1]!, points[i]!);
  return n;
}

/** A cable's length to order: the drawn route plus the extra entered, to 0.1 m. */
export function cableLength(c: Pick<CableRun, "points" | "extraM">): number {
  return round1(polylineLength(c.points) + Math.max(0, c.extraM || 0));
}

/** Total cable length by kind (only kinds that have runs). */
export function cableTotals(cables: readonly CableRun[]): { kind: CableKind; lengthM: number; runs: number }[] {
  return CABLE_KINDS.flatMap((kind) => {
    const runs = cables.filter((c) => c.kind === kind);
    return runs.length ? [{ kind, lengthM: round1(runs.reduce((n, c) => n + cableLength(c), 0)), runs: runs.length }] : [];
  });
}

const overlaps = (a: Obstruction, b: Obstruction, gap: number) => a.x < b.x + b.w + gap - 1e-9 && a.x + a.w + gap > b.x + 1e-9 && a.y < b.y + b.h + gap - 1e-9 && a.y + a.h + gap > b.y + 1e-9;

/**
 * Fill a dragged rectangle on a roof plane with panels in rows from the
 * corner where the drag started, keeping the roof's edge setback, clear of
 * obstructions (same setback) and of panels already placed.
 */
export function fillArea(
  roof: readonly Point[],
  area: { from: Point; to: Point },
  panel: { width: number; height: number },
  opts: { setback: number; gap?: number; landscape?: boolean; obstructions?: readonly Obstruction[]; existing?: readonly Obstruction[] },
): { x: number; y: number; w: number; h: number }[] {
  const w = opts.landscape ? panel.height : panel.width;
  const h = opts.landscape ? panel.width : panel.height;
  const gap = opts.gap ?? 0.02;
  // Clamp to the roof inside its setback, so a drag that starts on the edge still lines up from the setback.
  const rx = roof.map((p) => p.x);
  const ry = roof.map((p) => p.y);
  const lo = { x: Math.min(...rx) + opts.setback, y: Math.min(...ry) + opts.setback };
  const hi = { x: Math.max(...rx) - opts.setback, y: Math.max(...ry) - opts.setback };
  /**
   * One side of the drag: the dragged span clamped to the roof. A drag
   * thinner than a panel is a line: it becomes one panel's depth centred on
   * where the drag started, nudged inside the roof, so dragging along the
   * roof lays a single row (or column).
   */
  const span = (a: number, b: number, size: number, min: number, max: number): [number, number] => {
    if (Math.abs(b - a) >= size) return [Math.max(Math.min(a, b), min), Math.min(Math.max(a, b), max)];
    const start = Math.min(Math.max(a - size / 2, min), max - size);
    return [start, start + size + 1e-9];
  };
  const [minX, maxX] = span(area.from.x, area.to.x, w, lo.x, hi.x);
  const [minY, maxY] = span(area.from.y, area.to.y, h, lo.y, hi.y);
  if (maxX <= minX || maxY <= minY) return [];
  const cols = Math.floor((maxX - minX + gap + 1e-9) / (w + gap));
  const rows = Math.floor((maxY - minY + gap + 1e-9) / (h + gap));
  // Grow from the drag's starting corner, so the first panel lands where the drag began.
  const leftToRight = area.from.x <= area.to.x;
  const topToBottom = area.from.y <= area.to.y;
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = leftToRight ? minX + c * (w + gap) : maxX - w - c * (w + gap);
      const y = topToBottom ? minY + r * (h + gap) : maxY - h - r * (h + gap);
      const rect = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, w, h };
      if (!rectFits(rect, roof, opts.setback)) continue;
      if (opts.obstructions?.some((o) => overlaps(rect, o, opts.setback))) continue;
      if (opts.existing?.some((o) => overlaps(rect, o, 0))) continue;
      placed.push(rect);
    }
  }
  return placed;
}

/**
 * Drag-and-drop a placed panel by (dx, dy) metres, snapped to 5 cm. Null
 * when it would leave the roof's setback or overlap another panel or an
 * obstruction, so the designer puts it back.
 */
export function movePanel(
  roof: readonly Point[],
  panels: readonly PanelRect[],
  index: number,
  by: { dx: number; dy: number },
  opts: { setback: number; obstructions?: readonly Obstruction[] },
): PanelRect | null {
  const p = panels[index];
  if (!p) return null;
  const snap = (v: number) => Math.round(v * 20) / 20;
  const moved = { ...p, x: snap(p.x + by.dx), y: snap(p.y + by.dy) };
  if (!rectFits(moved, roof, opts.setback)) return null;
  if (opts.obstructions?.some((o) => overlaps(moved, o, opts.setback))) return null;
  if (panels.some((o, i) => i !== index && overlaps(moved, o, 0))) return null;
  return moved;
}

/** Indexes of panels whose centre lies inside the dragged rectangle. */
export function panelsInArea(panels: readonly PanelRect[], area: { from: Point; to: Point }): number[] {
  const box = [
    { x: area.from.x, y: area.from.y },
    { x: area.to.x, y: area.from.y },
    { x: area.to.x, y: area.to.y },
    { x: area.from.x, y: area.to.y },
  ];
  return panels.flatMap((p, i) => (insidePolygon({ x: p.x + p.w / 2, y: p.y + p.h / 2 }, box) ? [i] : []));
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

interface ArrayPanels {
  id: string;
  label: string;
  pitch: number;
  azimuth: number;
  used: boolean;
  panels: PanelRect[];
}

export interface DrawnString {
  /** 1-based string number. */
  n: number;
  panels: number;
  mppt: number;
  arrays: string[];
}

/** Strings as wired on the plan, plus panels not on a string yet. Empty when nothing is wired (auto layout). */
export function drawnStrings(arrays: readonly ArrayPanels[], plan: StringPlan | null): { strings: DrawnString[]; unassigned: number } {
  const used = arrays.filter((a) => a.used);
  const numbers = [...new Set(used.flatMap((a) => a.panels.map((p) => p.s).filter((s): s is number => typeof s === "number" && s > 0)))].sort((a, b) => a - b);
  const strings = numbers.map((n) => ({
    n,
    panels: used.reduce((k, a) => k + a.panels.filter((p) => p.s === n).length, 0),
    mppt: plan?.strings[n - 1]?.mppt ?? n,
    arrays: used.filter((a) => a.panels.some((p) => p.s === n)).map((a) => a.id),
  }));
  const unassigned = numbers.length ? used.reduce((k, a) => k + a.panels.filter((p) => !p.s).length, 0) : 0;
  return { strings, unassigned };
}

export interface StringCheck {
  strings: { n: number; panels: number; mppt: number; vocColdV: number | null; vmpV: number | null; issues: string[] }[];
  mppts: { mppt: number; strings: number[]; iscA: number | null; issues: string[] }[];
  /** Missing datasheet values or settings: the checks they block are skipped, not guessed. */
  notes: string[];
  ok: boolean;
}

const v = (n: number) => `${Math.round(n)} V`;

/**
 * Check wired strings against the panel and inverter datasheets: panels per
 * string within the voltage window (Voc at the minimum design temperature
 * under the inverter's max input, Vmp over the MPPT minimum), strings in
 * parallel on one MPPT matched and within its input current.
 */
export function checkStrings(
  panel: PanelSpecs,
  inverter: InverterSpecs,
  settings: { minDesignTempC?: number | null },
  drawn: { strings: DrawnString[]; unassigned: number },
  arrays: readonly Pick<ArrayPanels, "id" | "label" | "pitch" | "azimuth">[],
): StringCheck {
  const notes: string[] = [];
  const limits = stringLimits(panel, inverter, settings);
  if (!limits.ok) notes.push(limits.missing);
  else if (!limits.vocCorrected) notes.push("String voltages use uncorrected Voc: set the minimum design temperature and the panel's Voc temperature coefficient.");
  const vocCold = panel.voc ? (settings.minDesignTempC != null && panel.temp_coeff_voc != null ? panel.voc * (1 + (panel.temp_coeff_voc / 100) * (settings.minDesignTempC - 25)) : panel.voc) : null;
  const mpptCount = inverter.mppt_count ?? null;
  if (mpptCount == null) notes.push("The inverter needs its number of MPPT inputs to check string inputs.");

  const strings = drawn.strings.map((s) => {
    const issues: string[] = [];
    const vocColdV = vocCold ? s.panels * vocCold : null;
    const vmpV = panel.vmp ? s.panels * panel.vmp : null;
    if (limits.ok) {
      if (s.panels > limits.maxPerString) issues.push(`${s.panels} panels is over the ${limits.maxPerString} maximum: ${v(vocColdV!)} cold Voc exceeds the inverter's ${v(inverter.max_input_v!)}.`);
      if (s.panels < limits.minPerString) issues.push(`${s.panels} panels is under the ${limits.minPerString} minimum: ${v(vmpV!)} Vmp is below the MPPT range (${v(inverter.mppt_min_v!)}).`);
    }
    if (vmpV && inverter.mppt_max_v && vmpV > inverter.mppt_max_v) issues.push(`${v(vmpV)} Vmp is above the MPPT range (${v(inverter.mppt_max_v)}).`);
    if (mpptCount != null && (s.mppt < 1 || s.mppt > mpptCount)) issues.push(`The inverter has ${mpptCount} MPPT input${mpptCount === 1 ? "" : "s"}; choose one of them.`);
    const faces = arrays.filter((a) => s.arrays.includes(a.id));
    if (faces.length > 1 && faces.some((a) => Math.round(a.pitch) !== Math.round(faces[0]!.pitch) || Math.round(a.azimuth) !== Math.round(faces[0]!.azimuth)))
      issues.push(`Spans ${faces.map((a) => a.label.split(" · ")[0]).join(" and ")}, which face different ways: panels in a string should share pitch and direction.`);
    return { n: s.n, panels: s.panels, mppt: s.mppt, vocColdV: vocColdV === null ? null : Math.round(vocColdV * 10) / 10, vmpV: vmpV === null ? null : Math.round(vmpV * 10) / 10, issues };
  });

  const mpptNumbers = [...new Set(drawn.strings.map((s) => s.mppt))].sort((a, b) => a - b);
  const mppts = mpptNumbers.map((m) => {
    const on = drawn.strings.filter((s) => s.mppt === m);
    const issues: string[] = [];
    if (on.length > 1 && on.some((s) => s.panels !== on[0]!.panels)) issues.push(`Strings ${on.map((s) => s.n).join(" and ")} are in parallel with different panel counts; parallel strings must match.`);
    const iscA = panel.isc ? Math.round(on.length * panel.isc * 100) / 100 : null;
    if (on.length > 1) {
      if (iscA === null) notes.push("The panel needs Isc to check strings in parallel.");
      else if (!inverter.max_input_a) notes.push("The inverter needs its max input current per MPPT to check strings in parallel.");
      else if (iscA > inverter.max_input_a) issues.push(`${on.length} strings in parallel draw ${iscA} A (Isc), over the input's ${inverter.max_input_a} A.`);
    }
    return { mppt: m, strings: on.map((s) => s.n), iscA, issues };
  });

  if (drawn.unassigned) notes.push(`${drawn.unassigned} panel${drawn.unassigned === 1 ? " isn't" : "s aren't"} on a string yet.`);
  const ok = limits.ok && !drawn.unassigned && strings.every((s) => !s.issues.length) && mppts.every((m) => !m.issues.length);
  return { strings, mppts, notes: [...new Set(notes)], ok };
}

/**
 * Wire every used panel into strings: one roof per MPPT input where each
 * roof makes a valid string and there are enough inputs, otherwise split all
 * panels evenly (as the automatic layout does). Panels are taken row by row.
 */
export function autoAssignStrings<A extends ArrayPanels>(
  arrays: readonly A[],
  panel: PanelSpecs,
  inverter: InverterSpecs,
  settings: { minDesignTempC?: number | null },
): { ok: true; arrays: A[]; plan: StringPlan } | { ok: false; missing: string } {
  const limits = stringLimits(panel, inverter, settings);
  if (!limits.ok) return limits;
  const inputs = Math.max(1, inverter.mppt_count ?? 1);
  const used = arrays.filter((a) => a.used && a.panels.length);
  const ordered = (a: A) => a.panels.map((p, i) => ({ p, i })).sort((x, y) => x.p.y - y.p.y || x.p.x - y.p.x);

  // Each roof on its own input(s).
  const perRoof = used.map((a) => layoutStrings(a.panels.length, limits, inputs));
  const perRoofCount = perRoof.reduce((n, r) => n + (r.ok ? r.strings.length : Infinity), 0);
  const assignment = new Map<A, number[]>(); // panel index → string number
  const plan: StringPlan = { strings: [] };
  if (perRoofCount <= inputs) {
    let n = 0;
    used.forEach((a, k) => {
      const sizes = (perRoof[k] as { ok: true; strings: number[] }).strings;
      const nums = new Array<number>(a.panels.length);
      let at = 0;
      const order = ordered(a);
      for (const size of sizes) {
        n++;
        plan.strings.push({ mppt: n });
        for (let j = 0; j < size; j++) nums[order[at++]!.i] = n;
      }
      assignment.set(a, nums);
    });
  } else {
    const total = used.reduce((n, a) => n + a.panels.length, 0);
    const layout = layoutStrings(total, limits, inputs);
    if (!layout.ok) return layout;
    layout.strings.forEach((_, i) => plan.strings.push({ mppt: i + 1 }));
    const flat = used.flatMap((a) => ordered(a).map((o) => ({ a, i: o.i })));
    let at = 0;
    layout.strings.forEach((size, i) => {
      for (let j = 0; j < size; j++) {
        const { a, i: idx } = flat[at++]!;
        const nums = assignment.get(a) ?? new Array<number>(a.panels.length);
        nums[idx] = i + 1;
        assignment.set(a, nums);
      }
    });
  }
  return {
    ok: true,
    plan,
    arrays: arrays.map((a) => {
      const nums = assignment.get(a);
      return { ...a, panels: a.panels.map((p, i) => ({ ...p, s: nums?.[i] ?? null })) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Single line diagram
// ---------------------------------------------------------------------------

export interface SldInput {
  panel: { name: string; specs: PanelSpecs } | null;
  inverter: { name: string; specs: InverterSpecs } | null;
  battery: { name: string; usableKwh: number | null; count: number } | null;
  /** Strings as wired, or the automatic split (no MPPT plan) when nothing is wired. */
  strings: { n: number; panels: number; mppt: number }[];
  minDesignTempC?: number | null;
  supply: { phases: 1 | 3; mainFuseA: number | null; earthing: string | null };
  ev: { name: string; kw: number | null; cableMm2: number | null; lengthM: number | null; protection: string | null } | null;
  cables: readonly CableRun[];
}

export interface SldModel {
  strings: { n: number; panels: number; mppt: number; kWp: number | null; vocColdV: number | null; iscA: number | null }[];
  mppts: number[];
  panel: SldInput["panel"];
  inverter: { name: string; acKw: number | null; mpptCount: number | null; hybrid: boolean; phases: number | null } | null;
  battery: { name: string; usableKwh: number | null; count: number; coupling: "dc" | "ac" } | null;
  ev: SldInput["ev"];
  supply: SldInput["supply"];
  cableTotals: ReturnType<typeof cableTotals>;
  /** Values the drawing shows as blanks, to fill in on site. */
  blanks: string[];
}

/**
 * Everything the single line diagram draws, from the design. Ratings the
 * design doesn't know (isolators, protective devices, cable sizes) are left
 * blank and listed, never assumed.
 */
export function sldModel(input: SldInput): SldModel {
  const s = input.panel?.specs;
  const vocCold = s?.voc ? (input.minDesignTempC != null && s.temp_coeff_voc != null ? s.voc * (1 + (s.temp_coeff_voc / 100) * (input.minDesignTempC - 25)) : s.voc) : null;
  const strings = input.strings.map((x) => ({
    n: x.n,
    panels: x.panels,
    mppt: x.mppt,
    kWp: s?.watts_peak ? Math.round(x.panels * s.watts_peak) / 1000 : null,
    vocColdV: vocCold ? Math.round(x.panels * vocCold * 10) / 10 : null,
    iscA: s?.isc ?? null,
  }));
  const hybrid = Boolean(input.inverter?.specs.hybrid);
  const blanks = ["DC isolator rating", "AC isolator rating", "Inverter circuit protective device", "DC and AC cable sizes"];
  if (input.battery) blanks.push(hybrid ? "Battery DC protection" : "Battery circuit protective device");
  if (input.ev && !input.ev.protection) blanks.push("EV circuit protective device");
  if (input.ev && input.ev.cableMm2 == null) blanks.push("EV cable size");
  if (input.supply.mainFuseA == null) blanks.push("Main fuse rating");
  if (!input.supply.earthing) blanks.push("Earthing arrangement");
  return {
    strings,
    mppts: [...new Set(strings.map((x) => x.mppt))].sort((a, b) => a - b),
    panel: input.panel,
    inverter: input.inverter
      ? { name: input.inverter.name, acKw: input.inverter.specs.ac_kw ?? null, mpptCount: input.inverter.specs.mppt_count ?? null, hybrid, phases: input.inverter.specs.phases ?? null }
      : null,
    battery: input.battery ? { ...input.battery, coupling: hybrid ? "dc" : "ac" } : null,
    ev: input.ev,
    supply: input.supply,
    cableTotals: cableTotals(input.cables),
    blanks,
  };
}
