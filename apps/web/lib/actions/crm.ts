"use server";

import { CONTACT_STAGES, PROJECT_STAGES, validateStageChange, type ProjectStage } from "@goinstall/core";
import { pgErrorCode, sql } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { notifyTeam } from "@/lib/notify";
import { asUser } from "@/lib/auth";

export interface ActionResult {
  error?: string;
  message?: string;
}

const productSchema = z.enum(["solar", "battery", "ev"]);
const optional = z
  .string()
  .trim()
  .transform((v) => v || null)
  .nullable()
  .optional();

const contactFields = {
  name: z.string().trim().min(1, "Enter the customer's name"),
  phone: optional,
  email: z
    .union([z.literal(""), z.email("Enter a valid email address")])
    .optional()
    .transform((v) => v || null),
  address_line1: optional,
  address_line2: optional,
  town: optional,
  county: optional,
  postcode: optional.transform((v) => v?.toUpperCase() ?? null),
  source: optional,
  owner_id: z
    .union([z.literal(""), z.uuid()])
    .optional()
    .transform((v) => v || null),
};

function formObject(form: FormData) {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) {
    if (k.startsWith("$")) continue; // React's internal action fields
    obj[k] = typeof v === "string" ? v : undefined;
  }
  obj.products = form.getAll("products").map(String);
  return obj;
}

const enquirySchema = z.object({
  ...contactFields,
  products: z.array(productSchema).min(1, "Choose at least one product"),
  note: optional,
  // From a picked Google address: where the map starts.
  lat: z.coerce.number().min(49).max(61).optional(),
  lng: z.coerce.number().min(-9).max(2.5).optional(),
});

/** "+ New enquiry": create the contact and its first project together. */
export async function createEnquiryAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = enquirySchema.safeParse(formObject(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { products, note, lat, lng, ...contact } = parsed.data;

  const { projectId, companyId, owner, me } = await asUser(async (tx, session) => {
    const owner = contact.owner_id ?? session.userId;
    const c = await tx
      .insertInto("contacts")
      .values({ ...contact, owner_id: owner, interested_in: products })
      .returning("id")
      .executeTakeFirstOrThrow();
    const p = await tx
      .insertInto("projects")
      .values({
        contact_id: c.id,
        products,
        owner_id: owner,
        site_address_line1: contact.address_line1,
        site_address_line2: contact.address_line2,
        site_town: contact.town,
        site_county: contact.county,
        site_postcode: contact.postcode,
        ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    if (note) {
      await tx
        .insertInto("messages")
        .values({ contact_id: c.id, project_id: p.id, channel: "note", direction: "internal", body: note, sent_by: session.userId })
        .execute();
    }
    return { projectId: p.id, companyId: session.companyId, owner, me: session.userId };
  });
  // Someone else's enquiry: tell its owner.
  if (owner !== me) await notifyTeam(companyId, "new_enquiry", { projectId, recipients: [owner], data: { site: [contact.address_line1, contact.town].filter(Boolean).join(", ") || undefined, detail: `${contact.name}, added by a colleague.` } });
  revalidatePath("/", "layout");
  redirect(`/projects/${projectId}`);
}

export async function updateContactAction(contactId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = z
    .object({ ...contactFields, products: z.array(productSchema) })
    .safeParse(formObject(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { products, ...fields } = parsed.data;
  const n = await asUser(async (tx) => {
    const r = await tx
      .updateTable("contacts")
      .set({ ...fields, interested_in: products })
      .where("id", "=", z.uuid().parse(contactId))
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  });
  if (!n) return { error: "Contact not found." };
  revalidatePath(`/contacts/${contactId}`);
  return { message: "Saved." };
}

/** Kanban move. Returns the contact's resulting column, or an error. */
export async function moveContactAction(contactId: string, stage: string, lostReason?: string): Promise<ActionResult & { stage?: string }> {
  const s = z.enum(CONTACT_STAGES).safeParse(stage);
  if (!s.success) return { error: "Unknown stage." };
  if (s.data === "lost" && !lostReason?.trim()) return { error: "Give a reason for marking this contact lost." };
  try {
    const result = await asUser(async (tx) =>
      sql<{ stage: string }>`select public.set_contact_stage(${z.uuid().parse(contactId)}, ${s.data}::public.contact_stage, ${lostReason ?? null}) as stage`.execute(tx),
    );
    revalidatePath("/", "layout");
    return { stage: result.rows[0]?.stage };
  } catch (err) {
    if (pgErrorCode(err) === "23514") return { error: "This contact has a project past the deposit stage, so it can't be marked lost." };
    if (pgErrorCode(err) === "P0002") return { error: "Contact not found." };
    throw err;
  }
}

export async function setContactsViewAction(view: "kanban" | "list") {
  await asUser(async (tx, session) => {
    await tx
      .updateTable("users")
      .set({ preferences: sql`preferences || ${JSON.stringify({ contacts_view: view })}::jsonb` })
      .where("id", "=", session.userId)
      .execute();
  });
  revalidatePath("/contacts");
}

const noteSchema = z.object({
  body: z.string().trim().min(1, "Write a note first"),
  project_id: z
    .union([z.literal(""), z.uuid()])
    .optional()
    .transform((v) => v || null),
});

export async function addNoteAction(contactId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = noteSchema.safeParse(formObject(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  await asUser(async (tx, session) => {
    await tx
      .insertInto("messages")
      .values({
        contact_id: z.uuid().parse(contactId),
        project_id: parsed.data.project_id,
        channel: "note",
        direction: "internal",
        body: parsed.data.body,
        sent_by: session.userId,
      })
      .execute();
  });
  revalidatePath("/", "layout");
  return { message: "Note added." };
}

export async function addProjectAction(contactId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const products = z.array(productSchema).min(1, "Choose at least one product").safeParse(form.getAll("products"));
  if (!products.success) return { error: products.error.issues[0]?.message };
  const id = await asUser(async (tx, session) => {
    const c = await tx
      .selectFrom("contacts")
      .select(["id", "address_line1", "address_line2", "town", "county", "postcode", "owner_id"])
      .where("id", "=", z.uuid().parse(contactId))
      .executeTakeFirstOrThrow();
    const p = await tx
      .insertInto("projects")
      .values({
        contact_id: c.id,
        products: products.data,
        owner_id: c.owner_id ?? session.userId,
        site_address_line1: c.address_line1,
        site_address_line2: c.address_line2,
        site_town: c.town,
        site_county: c.county,
        site_postcode: c.postcode,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return p.id;
  });
  revalidatePath("/", "layout");
  redirect(`/projects/${id}`);
}

export async function changeProjectStageAction(projectId: string, to: string, lostReason?: string): Promise<ActionResult> {
  const target = z.enum([...PROJECT_STAGES, "lost"]).safeParse(to);
  if (!target.success) return { error: "Unknown stage." };
  return asUser(async (tx) => {
    const p = await tx.selectFrom("projects").select(["stage"]).where("id", "=", z.uuid().parse(projectId)).executeTakeFirst();
    if (!p) return { error: "Project not found." };
    const check = validateStageChange(p.stage as ProjectStage, target.data, { lostReason });
    if (!check.ok) return { error: check.error };
    await tx
      .updateTable("projects")
      .set({ stage: target.data, ...(target.data === "lost" ? { lost_reason: lostReason!.trim() } : {}) })
      .where("id", "=", projectId)
      .execute();
    revalidatePath("/", "layout");
    return { message: "Stage updated." };
  });
}

const projectDetailsSchema = z.object({
  value: z
    .string()
    .trim()
    .transform((v) => (v ? Number(v.replace(/[£,\s]/g, "")) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), "Enter the value as a number"),
  owner_id: contactFields.owner_id,
  target_install_month: z
    .string()
    .trim()
    .transform((v) => (v ? `${v}-01` : null))
    .refine((v) => v === null || /^\d{4}-\d{2}-01$/.test(v), "Choose a month"),
  products: z.array(productSchema).min(1, "Choose at least one product"),
  site_address_line1: optional,
  site_address_line2: optional,
  site_town: optional,
  site_county: optional,
  site_postcode: optional.transform((v) => v?.toUpperCase() ?? null),
});

export async function updateProjectAction(projectId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = projectDetailsSchema.safeParse(formObject(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  await asUser((tx) =>
    tx
      .updateTable("projects")
      .set(parsed.data)
      .where("id", "=", z.uuid().parse(projectId))
      .execute(),
  );
  revalidatePath(`/projects/${projectId}`);
  return { message: "Saved." };
}
