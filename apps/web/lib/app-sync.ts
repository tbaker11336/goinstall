import "server-only";
import { firstName } from "@goinstall/core";
import { sql, withService, type Tx } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { z } from "zod";
import type { Session } from "./auth";
import { db } from "./db";
import { emailSender, fromAddress } from "./email";

/**
 * Offline captures from the installer app, replayed in order when the device
 * is back online. Every op is idempotent (ids are made on the device) and
 * conflicts are last-write-wins by capture time, with the overwritten value
 * kept in history.
 */
const at = z.iso.datetime({ offset: true });
export const opSchema = z.discriminatedUnion("type", [
  z.object({ opId: z.string().max(64), type: z.literal("survey_field"), surveyId: z.uuid(), key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/), value: z.string().max(5000).nullable(), capturedAt: at }),
  z.object({
    opId: z.string().max(64),
    type: z.literal("checklist_item"),
    id: z.uuid(),
    bookingId: z.uuid(),
    templateId: z.uuid().nullable(),
    done: z.boolean(),
    serial: z.string().max(200).nullable(),
    readings: z.record(z.string().max(60), z.string().max(60)),
    note: z.string().max(2000).nullable(),
    photoFileIds: z.array(z.uuid()).max(20),
    capturedAt: at,
  }),
  z.object({ opId: z.string().max(64), type: z.literal("booking_status"), bookingId: z.uuid(), status: z.enum(["in_progress", "completed"]), capturedAt: at }),
  z.object({ opId: z.string().max(64), type: z.literal("signoff"), bookingId: z.uuid(), name: z.string().trim().min(2).max(120), signatureFileId: z.uuid().nullable(), capturedAt: at }),
  z.object({ opId: z.string().max(64), type: z.literal("kit_issue"), kitItemId: z.uuid(), issue: z.enum(["missing", "damaged"]).nullable(), note: z.string().max(500).nullable(), capturedAt: at }),
  z.object({ opId: z.string().max(64), type: z.literal("on_my_way"), bookingId: z.uuid(), etaMinutes: z.number().int().min(1).max(600), capturedAt: at }),
]);
export type SyncOp = z.infer<typeof opSchema>;
export type OpResult = { opId: string; ok: boolean; note?: string; error?: string };

async function booking(tx: Tx, id: string) {
  return tx.selectFrom("bookings").select(["id", "project_id", "company_id", "type", "status", "started_at", "completed_at"]).where("id", "=", id).executeTakeFirst();
}

export async function applyOp(tx: Tx, session: Session, op: SyncOp): Promise<OpResult> {
  const ok = (note?: string): OpResult => ({ opId: op.opId, ok: true, note });
  const fail = (error: string): OpResult => ({ opId: op.opId, ok: false, error });
  const when = new Date(op.capturedAt);
  switch (op.type) {
    case "survey_field": {
      const survey = await tx.selectFrom("surveys").select(["id", "company_id"]).where("id", "=", op.surveyId).executeTakeFirst();
      if (!survey) return fail("Survey not found");
      const current = await tx.selectFrom("survey_fields").select(["value", "source", "updated_at"]).where("survey_id", "=", op.surveyId).where("key", "=", op.key).executeTakeFirst();
      if (current && current.updated_at > when) {
        // Someone changed it after this was captured: theirs stays, this one goes to history.
        await withService(db(), (s) =>
          s.insertInto("survey_field_history").values({ company_id: survey.company_id, survey_id: op.surveyId, key: op.key, value: op.value, source: "in_person", edited_by: session.userId, set_at: when }).execute(),
        );
        return ok("kept newer value");
      }
      await tx
        .insertInto("survey_fields")
        .values({ survey_id: op.surveyId, key: op.key, value: op.value, source: "in_person", edited_by: session.userId })
        .onConflict((oc) => oc.columns(["company_id", "survey_id", "key"]).doUpdateSet({ value: op.value, source: "in_person", edited_by: session.userId }))
        .execute();
      return ok();
    }
    case "checklist_item": {
      const b = await booking(tx, op.bookingId);
      if (!b?.project_id) return fail("Job not found");
      const t = op.templateId ? await tx.selectFrom("checklist_templates").select(["kind", "product", "title"]).where("id", "=", op.templateId).executeTakeFirst() : null;
      const existing = await tx.selectFrom("checklist_items").select(["captured_at"]).where("id", "=", op.id).executeTakeFirst();
      if (existing && existing.captured_at > when) return ok("kept newer value");
      const values = { done: op.done, serial: op.serial, readings: JSON.stringify(op.readings), note: op.note, photo_file_ids: op.photoFileIds, completed_by: session.userId, captured_at: when };
      if (existing) await tx.updateTable("checklist_items").set(values).where("id", "=", op.id).execute();
      else
        await tx
          .insertInto("checklist_items")
          .values({ id: op.id, booking_id: b.id, project_id: b.project_id, template_id: op.templateId, kind: t?.kind ?? "install", product: t?.product ?? "general", title: t?.title ?? "Step", ...values })
          .onConflict((oc) => oc.columns(["company_id", "booking_id", "template_id"]).doUpdateSet(values))
          .execute();
      return ok();
    }
    case "booking_status": {
      const b = await booking(tx, op.bookingId);
      if (!b) return fail("Job not found");
      if (op.status === "in_progress" && !b.started_at) await tx.updateTable("bookings").set({ status: "in_progress", started_at: when }).where("id", "=", b.id).execute();
      if (op.status === "completed" && !b.completed_at) await finishJob(tx, session, b, when, null);
      return ok();
    }
    case "signoff": {
      const b = await booking(tx, op.bookingId);
      if (!b) return fail("Job not found");
      await tx.updateTable("bookings").set({ signoff_name: op.name, signoff_signature_file_id: op.signatureFileId }).where("id", "=", b.id).execute();
      if (!b.completed_at) await finishJob(tx, session, b, when, op.name);
      return ok();
    }
    case "kit_issue": {
      const n = await tx.updateTable("kit_items").set({ issue: op.issue, issue_note: op.note }).where("id", "=", op.kitItemId).executeTakeFirst();
      if (!n.numUpdatedRows) return fail("Kit item not found");
      if (op.issue) {
        const k = await tx.selectFrom("kit_items").select(["project_id", "company_id", "description"]).where("id", "=", op.kitItemId).executeTakeFirstOrThrow();
        await serviceNote(k.company_id, k.project_id, `${session.fullName} reported ${k.description} ${op.issue}${op.note ? `: ${op.note}` : ""}`, "kit_issue");
      }
      return ok();
    }
    case "on_my_way": {
      const b = await booking(tx, op.bookingId);
      if (!b?.project_id) return fail("Job not found");
      // Installers can't write customer messages directly; the server does it once it knows they're on the job.
      if (Date.now() - when.getTime() > 3_600_000) return ok("too old to send");
      await withService(db(), async (s) => {
        const p = await s
          .selectFrom("projects as p")
          .innerJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
          .innerJoin("companies as co", "co.id", "p.company_id")
          .select(["p.id", "c.id as contact_id", "c.name", "c.email", "co.name as company_name", "co.email as company_email"])
          .where("p.id", "=", b.project_id!)
          .where("p.company_id", "=", b.company_id)
          .executeTakeFirstOrThrow();
        const already = await s.selectFrom("messages").select("id").where("project_id", "=", p.id).where("company_id", "=", b.company_id).where("subject", "like", "On my way%").where("created_at", ">", sql<Date>`now() - interval '2 hours'`).executeTakeFirst();
        if (already || !p.email) return;
        const subject = `On my way: ${p.company_name}`;
        const body = `Hi ${firstName(p.name)},\n\n${firstName(session.fullName)} from ${p.company_name} is on the way and should be with you in about ${op.etaMinutes} minutes.\n\n${p.company_name}`;
        const m = await s
          .insertInto("messages")
          .values({ company_id: b.company_id, contact_id: p.contact_id, project_id: p.id, channel: "email", direction: "outbound", subject, body, sent_by: session.userId, to_address: p.email, delivery_status: "queued", created_by: session.userId })
          .returning("id")
          .executeTakeFirstOrThrow();
        const r = await emailSender().send({ from: fromAddress(p.company_name), to: p.email, replyTo: p.company_email ?? undefined, subject, text: body, html: textToHtml(body), idempotencyKey: `omw-${op.opId}`, tags: { kind: "on_my_way" } });
        await s.updateTable("messages").set(r.ok ? { delivery_status: "sent", provider_message_id: r.providerId } : { delivery_status: "failed", delivery_error: r.error }).where("id", "=", m.id).execute();
      });
      return ok();
    }
  }
}

async function serviceNote(companyId: string, projectId: string, body: string, event: string) {
  await withService(db(), async (s) => {
    const p = await s.selectFrom("projects").select(["contact_id"]).where("id", "=", projectId).where("company_id", "=", companyId).executeTakeFirstOrThrow();
    await s.insertInto("messages").values({ company_id: companyId, contact_id: p.contact_id, project_id: projectId, channel: "system", direction: "internal", body, created_by: null }).execute();
    await s.insertInto("activity_log").values({ company_id: companyId, project_id: projectId, contact_id: p.contact_id, actor_id: null, event, payload: {} }).execute();
  });
}

/** Job completed in the app (balance invoice, certificates and handover pack follow in phase 6). */
async function finishJob(tx: Tx, session: Session, b: { id: string; project_id: string | null; company_id: string; type: string }, when: Date, signedBy: string | null) {
  await tx.updateTable("bookings").set({ status: "completed", completed_at: when }).where("id", "=", b.id).execute();
  if (b.project_id) {
    const label = b.type === "install" ? "Install" : b.type === "survey" ? "Site survey" : "Job";
    if (b.type === "survey") {
      await withService(db(), (s) => s.updateTable("surveys").set({ site_visit_status: "completed", site_visit_at: when }).where("project_id", "=", b.project_id!).where("company_id", "=", b.company_id).execute());
    }
    await serviceNote(b.company_id, b.project_id, `${label} completed by ${session.fullName}${signedBy ? `, signed off by ${signedBy}` : ""}`, `${b.type}_completed`);
  }
}
