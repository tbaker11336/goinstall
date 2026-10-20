/**
 * Survey rules shared by the console, the public survey page and (later) the
 * installer app: which questions and photos apply to a project, how complete
 * a survey is, and filling in message templates.
 */

export type Product = "solar" | "battery" | "ev";

export type FieldSource = "online" | "in_person" | "photo" | "staff_edit";

export interface SurveyQuestion {
  key: string;
  label: string;
  help: string | null;
  type: "text" | "long_text" | "number" | "select" | "yes_no";
  options: string[];
  /** Products the question applies to; empty means every project. */
  products: Product[];
  section: string;
  position: number;
  required: boolean;
  askOnline: boolean;
}

export interface PhotoCategory {
  key: string;
  label: string;
  help: string | null;
  products: Product[];
  required: boolean;
  position: number;
}

export interface SurveyField {
  key: string;
  value: string | null;
  source: FieldSource;
}

/** True when an item scoped to `itemProducts` applies to a project with `projectProducts`. */
export function appliesTo(itemProducts: readonly Product[], projectProducts: readonly Product[]): boolean {
  if (itemProducts.length === 0) return true;
  // A project with no products recorded yet gets every question, so nothing is missed.
  if (projectProducts.length === 0) return true;
  return itemProducts.some((p) => projectProducts.includes(p));
}

/** Questions for a project, in order. `online` limits to those the customer answers. */
export function questionsFor<Q extends SurveyQuestion>(questions: readonly Q[], products: readonly Product[], opts: { online?: boolean } = {}): Q[] {
  return questions
    .filter((q) => appliesTo(q.products, products) && (!opts.online || q.askOnline))
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}

export function photoCategoriesFor<C extends PhotoCategory>(categories: readonly C[], products: readonly Product[]): C[] {
  return categories.filter((c) => appliesTo(c.products, products)).sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}

/** Questions grouped by section, keeping question order. */
export function groupBySection<Q extends SurveyQuestion>(questions: readonly Q[]): { section: string; questions: Q[] }[] {
  const groups: { section: string; questions: Q[] }[] = [];
  for (const q of questions) {
    const group = groups.find((g) => g.section === q.section);
    if (group) group.questions.push(q);
    else groups.push({ section: q.section, questions: [q] });
  }
  return groups;
}

export function hasValue(v: string | null | undefined): v is string {
  return v !== null && v !== undefined && v.trim() !== "";
}

export interface SurveyProgress {
  answered: number;
  total: number;
  missingRequired: string[];
  photosTaken: number;
  photosRequired: number;
  missingPhotos: string[];
}

/**
 * How complete a survey is. `photoCounts` maps a photo category key to the
 * number of photos in it.
 */
export function surveyProgress(
  questions: readonly SurveyQuestion[],
  fields: readonly SurveyField[],
  categories: readonly PhotoCategory[],
  photoCounts: Readonly<Record<string, number>>,
): SurveyProgress {
  const values = new Map(fields.map((f) => [f.key, f.value]));
  const answered = questions.filter((q) => hasValue(values.get(q.key))).length;
  const missingRequired = questions.filter((q) => q.required && !hasValue(values.get(q.key))).map((q) => q.key);
  const required = categories.filter((c) => c.required);
  const missingPhotos = required.filter((c) => !(photoCounts[c.key] ?? 0)).map((c) => c.key);
  return {
    answered,
    total: questions.length,
    missingRequired,
    photosTaken: categories.filter((c) => (photoCounts[c.key] ?? 0) > 0).length,
    photosRequired: required.length,
    missingPhotos,
  };
}

/**
 * Normalise a customer or staff answer for storage. Returns an error message
 * for values the question can't accept.
 */
export function normaliseAnswer(q: Pick<SurveyQuestion, "type" | "options" | "label">, raw: string | null | undefined): { value: string | null } | { error: string } {
  const v = (raw ?? "").trim();
  if (v === "") return { value: null };
  switch (q.type) {
    case "number": {
      const n = Number(v.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) return { error: `${q.label}: enter a number` };
      return { value: String(n) };
    }
    case "select":
      return q.options.includes(v) ? { value: v } : { error: `${q.label}: choose one of the options` };
    case "yes_no":
      return v === "Yes" || v === "No" ? { value: v } : { error: `${q.label}: choose yes or no` };
    default:
      return { value: v.slice(0, 4000) };
  }
}

export type TemplateVars = Partial<Record<"first_name" | "name" | "company_name" | "survey_link" | "sender_name" | "site_address", string>>;

/**
 * Fill {{placeholders}} in a template. Unknown or empty placeholders become
 * empty strings, and blank lines left behind are tidied.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => (vars as Record<string, string | undefined>)[key] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Placeholders a template uses, for showing staff what will be filled in. */
export function templatePlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!))];
}

export function firstName(name: string): string {
  // "Martin & Jo Fielding" -> "Martin & Jo"; "Sarah Mitchell" -> "Sarah".
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? "";
  const amp = parts.findIndex((p) => p === "&" || p.toLowerCase() === "and");
  return amp > 0 && amp < parts.length - 2 ? parts.slice(0, amp + 2).join(" ") : parts[0]!;
}

export const SOURCE_LABELS: Record<FieldSource, string> = {
  online: "Online survey",
  in_person: "Site visit",
  photo: "From photo",
  staff_edit: "Edited by team",
};
