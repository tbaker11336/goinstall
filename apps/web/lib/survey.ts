import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { photoCategoriesFor, questionsFor, SURVEY_KINDS, type PhotoCategory, type Product, type SurveyField, type SurveyKind, type SurveyQuestion } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";
import { env } from "./env";

/** How long a survey link works for. */
export const SURVEY_LINK_DAYS = 30;

export function newSurveyToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSurveyToken(token), expiresAt: new Date(Date.now() + SURVEY_LINK_DAYS * 86_400_000) };
}

export function hashSurveyToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function surveyUrl(token: string) {
  return `${env.siteUrl.replace(/\/$/, "")}/s/${token}`;
}

/** Tokens are 43 base64url characters; reject anything else before hashing. */
export function isWellFormedToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export type QuestionRow = SurveyQuestion & { id: string };
export type CategoryRow = PhotoCategory & { id: string };

/**
 * One survey's active questions and photo categories, filtered to the
 * project's products within that survey (e.g. battery questions only when a
 * battery is wanted).
 */
export async function surveyConfig(tx: Tx, kind: SurveyKind, products: Product[], opts: { online?: boolean; companyId?: string } = {}) {
  let qq = tx
    .selectFrom("survey_questions")
    .select(["id", "key", "label", "help", "type", "options", "products", "section", "position", "required", "ask_online"])
    .where("archived_at", "is", null)
    .where("survey_kind", "=", kind);
  let cq = tx.selectFrom("photo_categories").select(["id", "key", "label", "help", "products", "required", "position"]).where("archived_at", "is", null).where("survey_kind", "=", kind);
  const inKind = products.filter((p) => SURVEY_KINDS[kind].products.includes(p));
  // The public page runs as the service role, so scope to the company explicitly.
  if (opts.companyId) {
    qq = qq.where("company_id", "=", opts.companyId);
    cq = cq.where("company_id", "=", opts.companyId);
  }
  const [questions, categories] = await Promise.all([qq.execute(), cq.execute()]);
  return {
    questions: questionsFor(
      questions.map(({ ask_online, ...q }) => ({ ...q, askOnline: ask_online })),
      inKind,
      { online: opts.online },
    ),
    categories: photoCategoriesFor(categories, inKind),
  };
}

export interface SurveyPhoto {
  id: string;
  category: string | null;
  path: string;
  source: string;
  original_name: string | null;
  created_at: Date;
}

/** Project photos; with a kind, those taken for that survey plus staff and app photos (no kind). */
export async function surveyPhotos(tx: Tx, projectId: string, companyId?: string, kind?: SurveyKind): Promise<SurveyPhoto[]> {
  let q = tx
    .selectFrom("files")
    .select(["id", "category", "path", "source", "original_name", "created_at"])
    .where("project_id", "=", projectId)
    .where("kind", "=", "photo")
    .where("deleted_at", "is", null)
    .orderBy("created_at");
  if (companyId) q = q.where("company_id", "=", companyId);
  if (kind) q = q.where((eb) => eb.or([eb("survey_kind", "=", kind), eb("survey_kind", "is", null)]));
  return q.execute();
}

export function photoCounts(photos: { category: string | null }[]) {
  const counts: Record<string, number> = {};
  for (const p of photos) if (p.category) counts[p.category] = (counts[p.category] ?? 0) + 1;
  return counts;
}

export interface PublicSurvey {
  surveyId: string;
  kind: SurveyKind;
  companyId: string;
  projectId: string;
  contactId: string;
  ownerId: string | null;
  status: "not_sent" | "sent" | "in_progress" | "completed";
  products: Product[];
  customerName: string;
  siteAddress: string | null;
  company: { name: string; phone: string | null; email: string | null; brandColour: string | null };
  fields: SurveyField[];
}

/**
 * Look up a survey by its link token. Runs with the service role (customers
 * have no login), so every query below is scoped to this one survey.
 */
export async function findPublicSurvey(tx: Tx, token: string): Promise<PublicSurvey | null> {
  if (!isWellFormedToken(token)) return null;
  const row = await tx
    .selectFrom("surveys as s")
    .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "s.project_id").onRef("p.company_id", "=", "s.company_id"))
    .innerJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
    .innerJoin("companies as co", "co.id", "s.company_id")
    .select([
      "s.id",
      "s.kind",
      "s.company_id",
      "s.project_id",
      "s.online_status",
      "p.products",
      "p.owner_id",
      "p.site_address_line1",
      "p.site_town",
      "p.stage",
      "c.id as contact_id",
      "c.name as contact_name",
      "co.name as company_name",
      "co.phone as company_phone",
      "co.email as company_email",
      "co.brand_primary_colour",
    ])
    .where("s.token_hash", "=", hashSurveyToken(token))
    .where("s.token_expires_at", ">", sql<Date>`now()`)
    .executeTakeFirst();
  // Lost projects don't take new answers.
  if (!row || row.stage === "lost") return null;
  const fields = await tx
    .selectFrom("survey_fields")
    .select(["key", "value", "source"])
    .where("company_id", "=", row.company_id)
    .where("survey_id", "=", row.id)
    .execute();
  return {
    surveyId: row.id,
    kind: row.kind,
    companyId: row.company_id,
    projectId: row.project_id,
    contactId: row.contact_id,
    ownerId: row.owner_id,
    status: row.online_status,
    products: row.products,
    customerName: row.contact_name,
    siteAddress: [row.site_address_line1, row.site_town].filter(Boolean).join(", ") || null,
    company: { name: row.company_name, phone: row.company_phone, email: row.company_email, brandColour: row.brand_primary_colour },
    fields,
  };
}

/** Record that the customer opened the link (shown on the Survey tab). */
export async function touchSurvey(tx: Tx, s: Pick<PublicSurvey, "surveyId" | "companyId">) {
  await tx.updateTable("surveys").set({ last_opened_at: sql<Date>`now()` }).where("id", "=", s.surveyId).where("company_id", "=", s.companyId).execute();
}

/** Survey answers the design uses, by key. */
export async function surveyAnswers(tx: Tx, projectId: string) {
  const rows = await tx
    .selectFrom("survey_fields as f")
    .innerJoin("surveys as s", "s.id", "f.survey_id")
    .select(["f.key", "f.value"])
    .where("s.project_id", "=", projectId)
    .execute();
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string | null>;
}
