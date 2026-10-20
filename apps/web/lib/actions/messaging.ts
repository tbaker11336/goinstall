"use server";

import { firstName, isSurveyKind, normaliseAnswer, renderTemplate, SURVEY_KINDS, surveyKindsFor, type SurveyKind } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser, type Session } from "@/lib/auth";
import { emailConfigured, emailSender, fromAddress } from "@/lib/email";
import { extensionFor, fileStore, IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/files";
import { newSurveyToken, surveyConfig, surveyUrl } from "@/lib/survey";
import { addressLine } from "@/lib/utils";
import type { ActionResult } from "./crm";

const uuid = z.uuid();

interface ContactForEmail {
  id: string;
  name: string;
  email: string | null;
  company_name: string;
  company_email: string | null;
}

async function contactForEmail(tx: Tx, contactId: string): Promise<ContactForEmail | undefined> {
  return tx
    .selectFrom("contacts as c")
    .innerJoin("companies as co", "co.id", "c.company_id")
    .select(["c.id", "c.name", "c.email", "co.name as company_name", "co.email as company_email"])
    .where("c.id", "=", contactId)
    .executeTakeFirst();
}

/**
 * Record an outbound email in the thread, then send it. The message row is
 * committed first (status queued), so a failed send still shows in the
 * thread with its error.
 */
async function sendAndRecord(
  session: Session,
  contact: ContactForEmail,
  email: { subject: string; body: string; projectId: string | null; kind: string },
): Promise<ActionResult> {
  if (!contact.email) return { error: `${contact.name} has no email address. Add one under Edit details.` };
  const messageId = await asUser(async (tx) => {
    const m = await tx
      .insertInto("messages")
      .values({
        contact_id: contact.id,
        project_id: email.projectId,
        channel: "email",
        direction: "outbound",
        subject: email.subject,
        body: email.body,
        sent_by: session.userId,
        to_address: contact.email,
        delivery_status: "queued",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return m.id;
  });

  const result = await emailSender().send({
    from: fromAddress(contact.company_name),
    to: contact.email,
    replyTo: session.email || contact.company_email || undefined,
    subject: email.subject,
    text: email.body,
    html: textToHtml(email.body),
    idempotencyKey: messageId,
    tags: { kind: email.kind },
  });

  await asUser((tx) =>
    tx
      .updateTable("messages")
      .set(
        result.ok
          ? { delivery_status: "sent", provider_message_id: result.providerId, delivery_error: null }
          : { delivery_status: "failed", delivery_error: result.error },
      )
      .where("id", "=", messageId)
      .execute(),
  );
  if (!result.ok) return { error: `Email not sent: ${result.error}` };
  return { message: emailConfigured() ? `Email sent to ${contact.email}.` : `Email recorded (sending isn't set up yet, so nothing was delivered).` };
}

const emailSchema = z.object({
  subject: z.string().trim().min(1, "Add a subject").max(200),
  body: z.string().trim().min(1, "Write a message").max(20_000),
  project_id: z
    .union([z.literal(""), z.uuid()])
    .optional()
    .transform((v) => v || null),
});

/** Composer: send an email from the contact page. */
export async function sendEmailAction(contactId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(contactId).success) return { error: "Contact not found" };
  const parsed = emailSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { session, contact } = await asUser(async (tx, session) => ({ session, contact: await contactForEmail(tx, contactId) }));
  if (!contact) return { error: "Contact not found" };
  const result = await sendAndRecord(session, contact, { ...parsed.data, projectId: parsed.data.project_id, kind: "manual" });
  revalidatePath(`/contacts/${contactId}`);
  return result;
}

/**
 * Create (or refresh) the project's online survey link. A new link replaces
 * the old one, so only the latest link works.
 */
async function issueSurveyLink(tx: Tx, projectId: string, kind: SurveyKind) {
  const { token, hash, expiresAt } = newSurveyToken();
  await tx
    .insertInto("surveys")
    .values({ project_id: projectId, kind, token_hash: hash, token_expires_at: expiresAt })
    .onConflict((oc) => oc.columns(["company_id", "project_id", "kind"]).doUpdateSet({ token_hash: hash, token_expires_at: expiresAt }))
    .execute();
  return { url: surveyUrl(token), expiresAt };
}

async function projectForSurvey(tx: Tx, projectId: string) {
  return tx
    .selectFrom("projects as p")
    .innerJoin("contacts as c", "c.id", "p.contact_id")
    .select(["p.id", "p.stage", "p.products", "p.contact_id", "p.site_address_line1", "p.site_town", "c.name as contact_name"])
    .where("p.id", "=", projectId)
    .executeTakeFirst();
}

/** "Send survey link": email the customer a fresh link for one survey and move the project to Survey. */
export async function sendSurveyLinkAction(projectId: string, kind: SurveyKind, _?: ActionResult, __?: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success || !isSurveyKind(kind)) return { error: "Project not found" };
  const prepared = await asUser(async (tx, session) => {
    const project = await projectForSurvey(tx, projectId);
    if (!project) return { error: "Project not found" } as const;
    if (project.stage === "lost") return { error: "This project is lost. Reopen it before sending a survey." } as const;
    const contact = await contactForEmail(tx, project.contact_id);
    if (!contact?.email) return { error: `${project.contact_name} has no email address. Add one under Edit details.` } as const;
    const template = await tx
      .selectFrom("message_templates")
      .select(["subject", "body"])
      .where("key", "=", "survey_link")
      .where("channel", "=", "email")
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!template) return { error: "The survey link email template is missing. Add it in Settings › Surveys." } as const;
    const { url } = await issueSurveyLink(tx, projectId, kind);
    const vars = {
      first_name: firstName(contact.name),
      name: contact.name,
      company_name: contact.company_name,
      survey_link: url,
      survey_name: SURVEY_KINDS[kind].label.toLowerCase(),
      sender_name: session.fullName,
      site_address: addressLine(project.site_address_line1, project.site_town),
    };
    // With two surveys, say which one this is if the template doesn't.
    const both = surveyKindsFor(project.products).length > 1;
    const subject = renderTemplate(template.subject ?? "", vars);
    return { session, contact, project, subject: both && !/survey_name/.test(template.subject ?? "") ? `${subject} (${SURVEY_KINDS[kind].short})` : subject, body: renderTemplate(template.body, vars) };
  });
  if ("error" in prepared) return { error: prepared.error };

  const result = await sendAndRecord(prepared.session, prepared.contact, {
    subject: prepared.subject,
    body: prepared.body,
    projectId,
    kind: "survey_link",
  });
  if (result.error) return result;

  await asUser(async (tx) => {
    await tx
      .updateTable("surveys")
      .set((eb) => ({
        sent_at: sql<Date>`now()`,
        sent_count: eb("sent_count", "+", 1),
        online_status: sql`case when online_status = 'not_sent' then 'sent'::online_survey_status else online_status end`,
      }))
      .where("project_id", "=", projectId)
      .where("kind", "=", kind)
      .execute();
    // Sending the online survey is what moves an enquiry into Survey.
    if (prepared.project.stage === "enquiry") await tx.updateTable("projects").set({ stage: "survey" }).where("id", "=", projectId).execute();
    await tx.insertInto("activity_log").values({ project_id: projectId, contact_id: prepared.project.contact_id, event: "survey_link_sent", payload: { channel: "email", kind } }).execute();
  });
  revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath(`/contacts/${prepared.project.contact_id}`);
  return result;
}

/** Contact page: send every survey the project needs and hasn't finished (one email each). */
export async function sendProjectSurveysAction(projectId: string): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Project not found" };
  const kinds = await asUser(async (tx) => {
    const p = await tx.selectFrom("projects").select("products").where("id", "=", projectId).executeTakeFirst();
    if (!p) return null;
    const done = (await tx.selectFrom("surveys").select("kind").where("project_id", "=", projectId).where("online_status", "=", "completed").execute()).map((r) => r.kind);
    return surveyKindsFor(p.products).filter((k) => !done.includes(k));
  });
  if (!kinds) return { error: "Project not found" };
  if (!kinds.length) return { error: "The customer has already completed the online survey." };
  const sent: string[] = [];
  let delivery = "";
  for (const k of kinds) {
    const r = await sendSurveyLinkAction(projectId, k);
    if (r.error) return { error: sent.length ? `${sent.join(" and ")} sent; ${SURVEY_KINDS[k].label.toLowerCase()} failed: ${r.error}` : r.error };
    sent.push(SURVEY_KINDS[k].label);
    delivery = r.message ?? "";
  }
  return { message: `${sent.join(" and ")} sent. ${delivery}`.trim() };
}

/** "Copy link": a fresh link staff can paste into a text message or another app. */
export async function createSurveyLinkAction(projectId: string, kind: SurveyKind): Promise<{ url?: string; error?: string }> {
  if (!uuid.safeParse(projectId).success || !isSurveyKind(kind)) return { error: "Project not found" };
  const out = await asUser(async (tx) => {
    const project = await projectForSurvey(tx, projectId);
    if (!project) return { error: "Project not found" };
    if (project.stage === "lost") return { error: "This project is lost. Reopen it before sending a survey." };
    const { url } = await issueSurveyLink(tx, projectId, kind);
    await tx
      .updateTable("surveys")
      .set({ online_status: sql`case when online_status = 'not_sent' then 'sent'::online_survey_status else online_status end`, sent_at: sql<Date>`coalesce(sent_at, now())` })
      .where("project_id", "=", projectId)
      .where("kind", "=", kind)
      .execute();
    if (project.stage === "enquiry") await tx.updateTable("projects").set({ stage: "survey" }).where("id", "=", projectId).execute();
    await tx.insertInto("activity_log").values({ project_id: projectId, contact_id: project.contact_id, event: "survey_link_created", payload: { kind } }).execute();
    return { url };
  });
  revalidatePath(`/projects/${projectId}`, "layout");
  return out;
}

/** Survey tab: save staff edits. Only changed fields are written, each marked "Edited by". */
export async function saveSurveyFieldsAction(projectId: string, kind: SurveyKind, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success || !isSurveyKind(kind)) return { error: "Project not found" };
  return asUser(async (tx, session) => {
    const project = await tx.selectFrom("projects").select(["id", "products"]).where("id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    const { questions } = await surveyConfig(tx, kind, project.products);
    await tx.insertInto("surveys").values({ project_id: projectId, kind }).onConflict((oc) => oc.columns(["company_id", "project_id", "kind"]).doNothing()).execute();
    const survey = await tx.selectFrom("surveys").select("id").where("project_id", "=", projectId).where("kind", "=", kind).executeTakeFirstOrThrow();
    const existing = new Map(
      (await tx.selectFrom("survey_fields").select(["key", "value"]).where("survey_id", "=", survey.id).execute()).map((f) => [f.key, f.value]),
    );
    let changed = 0;
    for (const q of questions) {
      if (!form.has(`f_${q.key}`)) continue;
      const result = normaliseAnswer(q, String(form.get(`f_${q.key}`)));
      if ("error" in result) return { error: result.error };
      if ((existing.get(q.key) ?? null) === result.value) continue;
      await tx
        .insertInto("survey_fields")
        .values({ survey_id: survey.id, key: q.key, value: result.value, source: "staff_edit", edited_by: session.userId })
        .onConflict((oc) => oc.columns(["company_id", "survey_id", "key"]).doUpdateSet({ value: result.value, source: "staff_edit", edited_by: session.userId }))
        .execute();
      changed++;
    }
    revalidatePath(`/projects/${projectId}/survey`);
    return { message: changed ? `${changed} ${changed === 1 ? "answer" : "answers"} saved.` : "No changes to save." };
  });
}

const siteVisitSchema = z.object({
  site_visit_status: z.enum(["not_needed", "recommended", "booked", "completed"]),
  site_visit_at: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Enter a valid date and time"),
  surveyor_id: z
    .union([z.literal(""), z.uuid()])
    .optional()
    .transform((v) => v || null),
});

/** Site visit card. Calendar booking and customer notification arrive with scheduling (phase 5). */
export async function updateSiteVisitAction(projectId: string, kind: SurveyKind, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success || !isSurveyKind(kind)) return { error: "Project not found" };
  const parsed = siteVisitSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  if (v.site_visit_status === "booked" && (!v.site_visit_at || !v.surveyor_id)) return { error: "Choose a date and a surveyor to book the visit." };
  return asUser(async (tx) => {
    const project = await tx.selectFrom("projects").select(["id", "contact_id", "stage"]).where("id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    await tx
      .insertInto("surveys")
      .values({ project_id: projectId, kind, ...v })
      .onConflict((oc) => oc.columns(["company_id", "project_id", "kind"]).doUpdateSet(v))
      .execute();
    if (v.site_visit_status === "booked") {
      // Booking an in-person survey also moves an enquiry into Survey.
      if (project.stage === "enquiry") await tx.updateTable("projects").set({ stage: "survey" }).where("id", "=", projectId).execute();
      await tx
        .insertInto("activity_log")
        .values({ project_id: projectId, contact_id: project.contact_id, event: "site_visit_booked", payload: { at: v.site_visit_at?.toISOString() } })
        .execute();
    }
    revalidatePath(`/projects/${projectId}`, "layout");
    return { message: "Site visit saved." };
  });
}

/**
 * "Mark complete": close one survey. Once every survey the project needs is
 * complete, the project moves to Design.
 */
export async function markSurveyCompleteAction(projectId: string, kind: SurveyKind): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success || !isSurveyKind(kind)) return { error: "Project not found" };
  return asUser(async (tx) => {
    const project = await tx.selectFrom("projects").select(["id", "stage", "contact_id", "products"]).where("id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    await tx
      .insertInto("surveys")
      .values({ project_id: projectId, kind, completed_at: sql<Date>`now()` })
      .onConflict((oc) => oc.columns(["company_id", "project_id", "kind"]).doUpdateSet({ completed_at: sql<Date>`now()` }))
      .execute();
    await tx.insertInto("activity_log").values({ project_id: projectId, contact_id: project.contact_id, event: "survey_marked_complete", payload: { kind } }).execute();
    const needed = surveyKindsFor(project.products);
    const done = (await tx.selectFrom("surveys").select("kind").where("project_id", "=", projectId).where("completed_at", "is not", null).execute()).map((r) => r.kind);
    const left = needed.filter((k) => !done.includes(k));
    revalidatePath(`/projects/${projectId}`, "layout");
    if (left.length) return { message: `${SURVEY_KINDS[kind].label} complete. Still to finish: ${left.map((k) => SURVEY_KINDS[k].label.toLowerCase()).join(", ")}.` };
    if (project.stage === "enquiry" || project.stage === "survey") {
      await tx.updateTable("projects").set({ stage: "design" }).where("id", "=", projectId).execute();
      return { message: "Survey complete. The project is now in Design." };
    }
    return { message: `${SURVEY_KINDS[kind].label} complete.` };
  });
}

/** Survey tab: staff upload a photo into a category. */
export async function uploadStaffPhotoAction(projectId: string, kind: SurveyKind, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success || !isSurveyKind(kind)) return { error: "Project not found" };
  const file = form.get("photo");
  const category = String(form.get("category") ?? "");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo to upload." };
  if (!IMAGE_TYPES.includes(file.type)) return { error: "Photos must be JPEG, PNG, WebP or HEIC." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That photo is too large (10 MB maximum)." };
  return asUser(async (tx, session) => {
    const project = await tx.selectFrom("projects").select(["id", "products", "company_id"]).where("id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    const { categories } = await surveyConfig(tx, kind, project.products);
    if (!categories.some((c) => c.key === category)) return { error: "Choose what the photo shows." };
    const id = randomUUID();
    const path = `${project.company_id}/${projectId}/${id}.${extensionFor(file.type)}`;
    await fileStore().put(path, new Uint8Array(await file.arrayBuffer()), file.type);
    await tx
      .insertInto("files")
      .values({ id, project_id: projectId, kind: "photo", survey_kind: kind, category, path, content_type: file.type, size_bytes: file.size, original_name: file.name.slice(0, 200), source: "staff", uploaded_by: session.userId })
      .execute();
    revalidatePath(`/projects/${projectId}/survey`);
    return { message: "Photo added." };
  });
}

export async function removePhotoAction(projectId: string, fileId: string): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(fileId).success) return { error: "Photo not found" };
  return asUser(async (tx) => {
    const r = await tx.updateTable("files").set({ deleted_at: sql<Date>`now()` }).where("id", "=", fileId).where("project_id", "=", projectId).executeTakeFirst();
    if (!r.numUpdatedRows) return { error: "Photo not found" };
    revalidatePath(`/projects/${projectId}/survey`);
    return { message: "Photo removed." };
  });
}
