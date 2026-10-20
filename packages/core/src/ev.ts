/**
 * EV charger design checks. The spec requires these to follow the business's
 * installation standards: cable tables (current ratings and mV/A/m by
 * installation method), the volt drop limit and the maximum demand method are
 * supplied by the business, never built in. Missing inputs are reported.
 */
import type { Result } from "./solar";

const missing = (reason: string) => ({ ok: false as const, missing: reason });

export interface Point {
  x: number;
  y: number;
}

/** Length of a polyline drawn on a plan, in the plan's units (metres when scaled). */
export function routeLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return Math.round(total * 10) / 10;
}

/** One row of the business's cable table. */
export interface CableRow {
  /** Conductor size, mm². */
  sizeMm2: number;
  /** Installation method code or name as the business uses it (e.g. "clipped direct", "buried"). */
  method: string;
  /** Current-carrying capacity for this method, A. */
  ratingA: number;
  /** Volt drop, mV per amp per metre. */
  mvPerAm: number;
}

/** Percent volt drop: mV/A/m × A × m / 1000, as a share of the nominal voltage. */
export function voltDropPercent(mvPerAm: number, currentA: number, lengthM: number, nominalV = 230): number {
  return Math.round(((mvPerAm * currentA * lengthM) / 1000 / nominalV) * 1000) / 10;
}

export interface CableSegment {
  lengthM: number;
  method: string;
}

/**
 * Smallest cable size that carries the design current under every segment's
 * installation method and keeps the total volt drop within the limit.
 */
export function sizeCable(
  segments: readonly CableSegment[],
  designCurrentA: number,
  rules: { cables: readonly CableRow[] | null; voltDropLimitPct: number | null; nominalV?: number },
): Result<{ sizeMm2: number; voltDropPct: number; withinLimit: true; lengthM: number }> {
  if (!rules.cables?.length) return missing("Upload your cable table in Settings › Design rules.");
  if (rules.voltDropLimitPct == null) return missing("Set the volt drop limit in Settings › Design rules.");
  if (!segments.length) return missing("Draw the cable route.");
  const lengthM = Math.round(segments.reduce((n, s) => n + s.lengthM, 0) * 10) / 10;
  const sizes = [...new Set(rules.cables.map((c) => c.sizeMm2))].sort((a, b) => a - b);
  for (const size of sizes) {
    const rows = segments.map((s) => rules.cables!.find((c) => c.sizeMm2 === size && c.method === s.method));
    if (rows.some((r) => !r)) continue;
    if (rows.some((r) => r!.ratingA < designCurrentA)) continue;
    // Each segment contributes its own length at its method's mV/A/m.
    const vd = segments.reduce((n, s, i) => n + voltDropPercent(rows[i]!.mvPerAm, designCurrentA, s.lengthM, rules.nominalV), 0);
    const voltDropPct = Math.round(vd * 10) / 10;
    if (voltDropPct <= rules.voltDropLimitPct) return { ok: true, sizeMm2: size, voltDropPct, withinLimit: true, lengthM };
  }
  const methods = [...new Set(segments.map((s) => s.method))];
  const unknown = methods.filter((m) => !rules.cables!.some((c) => c.method === m));
  if (unknown.length) return missing(`The cable table has no rows for: ${unknown.join(", ")}.`);
  return missing(`No cable in the table carries ${designCurrentA} A over ${lengthM} m within the ${rules.voltDropLimitPct}% volt drop limit.`);
}

/**
 * Maximum demand with the charger added, using the business's method:
 * the existing assessed demand plus the charger current at the business's
 * diversity (1 = no diversity, the usual assumption for EV charging).
 */
export function maxDemand(
  input: { existingDemandA: number | null; chargerA: number; mainFuseA: number | null },
  rules: { chargerDiversity: number | null },
): Result<{ demandA: number; mainFuseA: number; headroomA: number; loadManagementNeeded: boolean; fuseUpgradeWarning: boolean }> {
  if (input.mainFuseA == null) return missing("Add the main fuse rating (from the survey).");
  if (input.existingDemandA == null) return missing("Enter the existing maximum demand, assessed by your method.");
  if (rules.chargerDiversity == null) return missing("Set the charger diversity in Settings › Design rules.");
  const demandA = Math.round((input.existingDemandA + input.chargerA * rules.chargerDiversity) * 10) / 10;
  const headroomA = Math.round((input.mainFuseA - demandA) * 10) / 10;
  return { ok: true, demandA, mainFuseA: input.mainFuseA, headroomA, loadManagementNeeded: headroomA < 0, fuseUpgradeWarning: headroomA < 0 && input.mainFuseA < 100 };
}

/** Parse "100 A" / "100A" / "100" from a survey answer. */
export function parseAmps(v: string | null | undefined): number | null {
  const m = v?.match(/(\d+(?:\.\d+)?)\s*A?\b/i);
  return m ? Number(m[1]) : null;
}

/** Design current for a charger from its datasheet: rated amps, else kW over phases × V. */
export function chargerCurrentA(specs: { rated_a?: number; rated_kw?: number; phases?: number }, nominalV = 230): number | null {
  if (specs.rated_a) return specs.rated_a;
  if (!specs.rated_kw) return null;
  return Math.round(((specs.rated_kw * 1000) / ((specs.phases ?? 1) * nominalV)) * 10) / 10;
}

/** Rough miles a year an EV can run on solar the house doesn't use (shown, not quoted). */
export function evMilesFromSurplus(surplusKwh: number, milesPerKwh: number | null): number | null {
  return milesPerKwh ? Math.round((surplusKwh * milesPerKwh) / 100) * 100 : null;
}
