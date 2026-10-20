/**
 * Install checklists: steps per product with photo evidence, serials and
 * test readings. Readings are recorded as measured; no pass/fail values are
 * assumed (the business supplies any limits).
 */

export interface ReadingField {
  key: string;
  label: string;
  unit: string | null;
}

export interface ChecklistStep {
  id: string;
  kind: "install" | "handover";
  product: "solar" | "battery" | "ev" | "general";
  title: string;
  help: string | null;
  position: number;
  requiresPhoto: boolean;
  requiresSerial: boolean;
  readings: ReadingField[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "reading";

/** "Insulation resistance (MΩ)" per line → reading fields with unique keys. */
export function parseReadings(text: string): ReadingField[] {
  const out: ReadingField[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const label = (m ? m[1]! : line).trim().slice(0, 80);
    let key = slug(label);
    for (let i = 2; out.some((r) => r.key === key); i++) key = `${slug(label)}_${i}`;
    out.push({ key, label, unit: m ? m[2]!.trim().slice(0, 12) : null });
  }
  return out;
}

export function formatReadings(r: readonly ReadingField[]): string {
  return r.map((f) => (f.unit ? `${f.label} (${f.unit})` : f.label)).join("\n");
}

/** Steps that apply to a job with these products, in order. */
export function stepsForJob(steps: readonly ChecklistStep[], products: readonly string[], kind: "install" | "handover"): ChecklistStep[] {
  return steps.filter((s) => s.kind === kind && (s.product === "general" || products.includes(s.product))).sort((a, b) => a.position - b.position);
}

export interface CapturedStep {
  done: boolean;
  photoCount: number;
  serial: string | null;
  readings: Record<string, string>;
}

/** What still stops a step being complete. */
export function missingForStep(step: ChecklistStep, c: CapturedStep | undefined): string[] {
  const missing: string[] = [];
  if (step.requiresPhoto && !(c && c.photoCount > 0)) missing.push("photo");
  if (step.requiresSerial && !c?.serial?.trim()) missing.push("serial number");
  for (const r of step.readings) if (!c?.readings[r.key]?.trim()) missing.push(r.label);
  return missing;
}

/** Progress as done / total steps. */
export function checklistProgress(steps: readonly ChecklistStep[], captured: Record<string, CapturedStep | undefined>) {
  const done = steps.filter((s) => captured[s.id]?.done && missingForStep(s, captured[s.id]).length === 0).length;
  return { done, total: steps.length };
}
