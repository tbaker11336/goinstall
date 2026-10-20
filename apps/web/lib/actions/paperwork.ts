"use server";

import { randomUUID } from "node:crypto";
import { isValidMpanCore, MANUAL_FIELDS, PAPERWORK_STATUSES, PAPERWORK_TITLES, type PaperworkKind } from "@goinstall/core";
import { sql } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { emailConfigured, emailSender, fromAddress } from "@/lib/email";
import { extensionFor, fileStore, IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/files";
import { syncPaperwork } from "@/lib/paperwork";
import { buildHandoverPack, generateSheet } from "@/lib/paperwork-docs";
import type { ActionResult } from "./crm";

const uuid = z.uuid();
const text = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const done = (projectId: string, message: string): ActionResult => {
  revalidatePath(`/projects/${projectId}`, "layout");
  return { message };
};

const ITEM_COLUMNS = ["id", "project_id", "kind", "title", "timing", "fields", "product_id", "status", "due_date", "due_auto"] as const;

const itemSchema = z.object({
  status: z.enum(PAPERWORK_STATUSES),
  due_date: z.union([z.literal(""), z.iso.date()]),
  reference: z.string().max(120),
  portal_url: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(500)], { error: "The portal link must start with https://" }),
  notes: z.string().max(2000),
});

/** Status, due date, DNO/scheme reference, portal link, notes and the values staff enter. */
export async function savePaperworkItemAction(itemId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(itemId).success) return { error: "Item not found" };
  const parsed = itemSchema.safeParse(Object.fromEntries(["status", "due_date", "reference", "portal_url", "notes"].map((k) => [k, text(form, k)])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  return asUser(async (tx) => {
    const item = await tx.selectFrom("paperwork_items").select([...ITEM_COLUMNS]).where("id", "=", itemId).executeTakeFirst();
    if (!item) return { error: "Item not found" };
    const fields = Object.fromEntries((MANUAL_FIELDS[item.kind as PaperworkKind] ?? []).map((f) => [f.key, text(form, `field_${f.key}`).slice(0, 300)]).filter(([, v]) => v));
    const due = d.due_date || null;
    const prevDue = item.due_date ? item.due_date.toISOString().slice(0, 10) : null;
    await tx
      .updateTable("paperwork_items")
      .set({
        status: d.status,
        due_date: due,
        // A date staff choose themselves stops following the rules.
        due_auto: item.due_auto && due === prevDue,
        reference: d.reference || null,
        portal_url: d.portal_url || null,
        notes: d.notes || null,
        fields: JSON.stringify(fields),
        submitted_at: d.status === "to_do" ? null : sql<Date>`coalesce(submitted_at, now())`,
        completed_at: d.status === "done" || d.status === "approved" ? sql<Date>`coalesce(completed_at, now())` : null,
      })
      .where("id", "=", itemId)
      .execute();
    return done(item.project_id, "Saved.");
  });
}

/** The site's MPAN, used on every DNO form. */
export async function saveMpanAction(projectId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Project not found" };
  const mpan = text(form, "mpan").replace(/\s+/g, "");
  if (mpan && !/^\d{13}$/.test(mpan)) return { error: "Enter the 13-digit MPAN core (the bottom line on the bill's S box)." };
  return asUser(async (tx) => {
    const r = await tx.updateTable("projects").set({ mpan: mpan || null }).where("id", "=", projectId).executeTakeFirst();
    if (!r.numUpdatedRows) return { error: "Project not found" };
    return done(projectId, mpan && !isValidMpanCore(mpan) ? "Saved, but its check digit doesn't match: check it against the bill." : "MPAN saved.");
  });
}

/** Generate the pre-filled details sheet (or the handover pack) for one item. */
export async function generatePaperworkAction(itemId: string): Promise<ActionResult> {
  if (!uuid.safeParse(itemId).success) return { error: "Item not found" };
  return asUser(async (tx, session) => {
    const item = await tx.selectFrom("paperwork_items").select([...ITEM_COLUMNS]).where("id", "=", itemId).executeTakeFirst();
    if (!item) return { error: "Item not found" };
    const kind = item.kind as PaperworkKind;
    if (kind === "handover_pack") {
      const pack = await buildHandoverPack(tx, session, { ...item, kind });
      if (!pack) return { error: "Project not found" };
      return done(item.project_id, `Handover pack made.${pack.missing.length ? ` Not included yet: ${pack.missing.join(", ")}.` : ""}`);
    }
    await generateSheet(tx, session, { ...item, kind });
    return done(item.project_id, `${PAPERWORK_TITLES[kind]}: details sheet made.`);
  });
}

/** "Generate forms": a details sheet for every item still open (the handover pack is made when sending it). */
export async function generateAllPaperworkAction(projectId: string): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Project not found" };
  return asUser(async (tx, session) => {
    await syncPaperwork(tx, session.companyId, projectId);
    const items = await tx.selectFrom("paperwork_items").select([...ITEM_COLUMNS]).where("project_id", "=", projectId).where("kind", "!=", "handover_pack").where("status", "!=", "done").execute();
    for (const item of items) await generateSheet(tx, session, { ...item, kind: item.kind as PaperworkKind });
    return done(projectId, items.length ? `${items.length} details sheet${items.length === 1 ? "" : "s"} made.` : "Nothing open to generate.");
  });
}

/** Upload a certificate, approval letter or other document to an item. */
export async function uploadPaperworkFileAction(itemId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(itemId).success) return { error: "Item not found" };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.type !== "application/pdf" && !IMAGE_TYPES.includes(file.type)) return { error: "Upload a PDF or a photo (JPEG, PNG, WebP or HEIC)." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is too large (10 MB maximum)." };
  return asUser(async (tx, session) => {
    const item = await tx.selectFrom("paperwork_items").select(["id", "project_id"]).where("id", "=", itemId).executeTakeFirst();
    if (!item) return { error: "Item not found" };
    const id = randomUUID();
    const path = `${session.companyId}/${item.project_id}/${id}.${extensionFor(file.type)}`;
    await fileStore().put(path, new Uint8Array(await file.arrayBuffer()), file.type);
    await tx
      .insertInto("files")
      .values({ id, project_id: item.project_id, kind: "document", path, content_type: file.type, size_bytes: file.size, original_name: file.name.slice(0, 200), source: "staff", uploaded_by: session.userId, paperwork_item_id: item.id })
      .execute();
    return done(item.project_id, `${file.name} attached.`);
  });
}

export async function removePaperworkFileAction(fileId: string): Promise<ActionResult> {
  if (!uuid.safeParse(fileId).success) return { error: "File not found" };
  return asUser(async (tx) => {
    const f = await tx.updateTable("files").set({ deleted_at: sql<Date>`now()` }).where("id", "=", fileId).where("paperwork_item_id", "is not", null).returning("project_id").executeTakeFirst();
    if (!f?.project_id) return { error: "File not found" };
    return done(f.project_id, "File removed.");
  });
}

/** Make the handover pack and email it to the customer; the item is then done. */
export async function sendHandoverPackAction(projectId: string): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Project not found" };
  return asUser(async (tx, session) => {
    await syncPaperwork(tx, session.companyId, projectId);
    const item = await tx.selectFrom("paperwork_items").select([...ITEM_COLUMNS]).where("project_id", "=", projectId).where("kind", "=", "handover_pack").executeTakeFirst();
    if (!item) return { error: "The handover pack follows once the install is booked." };
    const p = await tx
      .selectFrom("projects as p")
      .innerJoin("contacts as c", "c.id", "p.contact_id")
      .innerJoin("companies as co", "co.id", "p.company_id")
      .select(["c.id as contact_id", "c.name", "c.email", "co.name as company_name", "co.email as company_email", "co.email_sender"])
      .where("p.id", "=", projectId)
      .executeTakeFirstOrThrow();
    if (!p.email) return { error: `${p.name} has no email address. Add one on the contact, or download the pack and send it another way.` };
    const pack = await buildHandoverPack(tx, session, { ...item, kind: "handover_pack" });
    if (!pack) return { error: "Project not found" };
    const first = p.name.split(/\s+/)[0] ?? p.name;
    const subject = `Your handover pack from ${p.company_name}`;
    const body = `Hi ${first},\n\nThank you for choosing ${p.company_name}. Attached is your handover pack: your system design, certificates and warranty details. Please keep it somewhere safe.\n\nIf you have any questions, just reply to this email.\n\n${session.fullName}\n${p.company_name}`;
    const m = await tx
      .insertInto("messages")
      .values({ contact_id: p.contact_id, project_id: projectId, channel: "email", direction: "outbound", subject, body, sent_by: session.userId, to_address: p.email, delivery_status: "queued" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const result = await emailSender().send({
      from: fromAddress(p.company_name, p.email_sender),
      to: p.email,
      replyTo: session.email || p.company_email || undefined,
      subject,
      text: body,
      html: textToHtml(body),
      idempotencyKey: m.id,
      tags: { kind: "handover_pack" },
      attachments: [{ filename: "handover-pack.pdf", content: pack.bytes, contentType: "application/pdf" }],
    });
    await tx.updateTable("messages").set(result.ok ? { delivery_status: "sent", provider_message_id: result.providerId } : { delivery_status: "failed", delivery_error: result.error }).where("id", "=", m.id).execute();
    if (!result.ok) return { error: `Pack made, but the email wasn't sent: ${result.error}` };
    await tx.updateTable("paperwork_items").set({ status: "done", submitted_at: sql<Date>`coalesce(submitted_at, now())`, completed_at: sql<Date>`now()` }).where("id", "=", item.id).execute();
    await tx.insertInto("activity_log").values({ project_id: projectId, contact_id: p.contact_id, event: "handover_pack_sent", payload: { missing: pack.missing } }).execute();
    const live = emailConfigured() ? `Emailed to ${p.email}.` : "Email recorded (sending isn't set up here, so nothing was delivered).";
    return done(projectId, `Handover pack sent. ${live}${pack.missing.length ? ` Not included yet: ${pack.missing.join(", ")}.` : ""}`);
  });
}

