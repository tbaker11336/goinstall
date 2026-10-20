import "server-only";
import type { ContactStage, ProductType, ProjectStage, Tx } from "@goinstall/db";
import { sql } from "@goinstall/db";

export interface ProjectRow {
  id: string;
  contact_id: string;
  contact_name: string;
  site_address_line1: string | null;
  site_town: string | null;
  site_postcode: string | null;
  products: ProductType[];
  stage: ProjectStage;
  value: string | null;
  owner_name: string | null;
  stage_changed_at: Date;
}

export async function listProjects(
  tx: Tx,
  filters: { stage?: ProjectStage | ProjectStage[]; q?: string; limit?: number } = {},
): Promise<ProjectRow[]> {
  let query = tx
    .selectFrom("projects as p")
    .innerJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
    .leftJoin("users as u", "u.id", "p.owner_id")
    .select([
      "p.id",
      "p.contact_id",
      "c.name as contact_name",
      "p.site_address_line1",
      "p.site_town",
      "p.site_postcode",
      "p.products",
      "p.stage",
      "p.value",
      "u.full_name as owner_name",
      "p.stage_changed_at",
    ])
    .orderBy("p.stage_changed_at", "desc")
    .limit(filters.limit ?? 200);
  if (Array.isArray(filters.stage)) query = query.where("p.stage", "in", filters.stage);
  else if (filters.stage) query = query.where("p.stage", "=", filters.stage);
  if (filters.q) {
    const like = `%${filters.q}%`;
    query = query.where((eb) =>
      eb.or([eb("c.name", "ilike", like), eb("p.site_address_line1", "ilike", like), eb("p.site_postcode", "ilike", like), eb("p.site_town", "ilike", like)]),
    );
  }
  return query.execute();
}

export async function projectStageCounts(tx: Tx): Promise<Partial<Record<ProjectStage, number>>> {
  const rows = await tx
    .selectFrom("projects")
    .select(["stage", sql<number>`count(*)::int`.as("n")])
    .groupBy("stage")
    .execute();
  return Object.fromEntries(rows.map((r) => [r.stage, r.n]));
}

export interface ContactFilters {
  q?: string;
  product?: ProductType;
  source?: string;
  owner?: string;
  stage?: ContactStage;
}

export interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  town: string | null;
  postcode: string | null;
  source: string | null;
  stage: ContactStage;
  interested_in: ProductType[];
  owner_name: string | null;
  last_activity_at: Date;
  status: string | null;
  /** Total value of the contact's open (not lost) projects. */
  value: string | null;
}

export async function listContacts(tx: Tx, f: ContactFilters): Promise<ContactRow[]> {
  let query = tx
    .selectFrom("contacts as c")
    .leftJoin("users as u", "u.id", "c.owner_id")
    .select([
      "c.id",
      "c.name",
      "c.email",
      "c.phone",
      "c.town",
      "c.postcode",
      "c.source",
      "c.stage",
      "c.interested_in",
      "u.full_name as owner_name",
      "c.last_activity_at",
      // One status line for the card: the lost reason or the latest event.
      sql<string | null>`coalesce(
        case when c.stage = 'lost' then 'Lost: ' || c.lost_reason end,
        (select m.body from messages m where m.contact_id = c.id and m.company_id = c.company_id order by m.created_at desc limit 1)
      )`.as("status"),
      sql<string | null>`(select sum(p.value) from projects p where p.contact_id = c.id and p.company_id = c.company_id and p.stage <> 'lost')`.as("value"),
    ])
    .orderBy("c.last_activity_at", "desc")
    .limit(500);

  if (f.q) {
    const like = `%${f.q}%`;
    const digits = f.q.replace(/\D/g, "");
    query = query.where((eb) =>
      eb.or([
        eb("c.name", "ilike", like),
        eb("c.email", "ilike", like),
        eb("c.address_line1", "ilike", like),
        eb("c.town", "ilike", like),
        eb("c.postcode", "ilike", like),
        ...(digits.length >= 4 ? [eb(sql`regexp_replace(c.phone, '\\D', '', 'g')`, "like", `%${digits.slice(-10)}%`)] : []),
      ]),
    );
  }
  if (f.product) query = query.where(sql<boolean>`${f.product}::product_type = any(c.interested_in)`);
  if (f.source) query = query.where("c.source", "=", f.source);
  if (f.owner) query = query.where("c.owner_id", "=", f.owner);
  if (f.stage) query = query.where("c.stage", "=", f.stage);
  return query.execute();
}

export async function listStaff(tx: Tx) {
  return tx
    .selectFrom("users")
    .select(["id", "full_name", "role"])
    .where("is_active", "=", true)
    .where("role", "in", ["admin", "office"])
    .orderBy("full_name")
    .execute();
}

export async function listSources(tx: Tx): Promise<string[]> {
  const rows = await tx.selectFrom("contacts").select("source").distinct().where("source", "is not", null).orderBy("source").execute();
  return rows.map((r) => r.source!).filter(Boolean);
}

/** Thread items for a contact: messages plus system events, newest first. */
export async function contactTimeline(tx: Tx, contactId: string, projectId?: string) {
  let messages = tx
    .selectFrom("messages as m")
    .leftJoin("users as u", "u.id", "m.sent_by")
    .select(["m.id", "m.channel", "m.direction", "m.subject", "m.body", "m.created_at", "m.project_id", "m.delivery_status", "m.delivery_error", "u.full_name as sender"])
    .where("m.contact_id", "=", contactId)
    .orderBy("m.created_at", "desc")
    .limit(200);
  if (projectId) messages = messages.where("m.project_id", "=", projectId);

  let events = tx
    .selectFrom("activity_log as a")
    .leftJoin("users as u", "u.id", "a.actor_id")
    .select(["a.id", "a.event", "a.payload", "a.created_at", "a.project_id", "u.full_name as actor"])
    .where("a.contact_id", "=", contactId)
    // These are also written to the thread as system messages; show them once.
    .where("a.event", "not in", ["online_survey_completed", "online_survey_updated"])
    .orderBy("a.created_at", "desc")
    .limit(200);
  if (projectId) events = events.where("a.project_id", "=", projectId);
  else events = events.where("a.event", "!=", "contact_stage_changed");

  const [m, e] = await Promise.all([messages.execute(), events.execute()]);
  return { messages: m, events: e };
}
