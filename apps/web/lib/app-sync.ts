import "server-only";
import { bookingDates, bookingTitle, firstName } from "@goinstall/core";
import { sql, withService, type Tx } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Session } from "./auth";
import { db } from "./db";
import { notifyCustomer, notifyTeam } from "./notify";
import { emailSender, fromAddress } from "./email";
import { fileStore } from "./files";

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
  z.object({
    opId: z.string().max(64),
    type: z.literal("signoff"),
    bookingId: z.uuid(),
    name: z.string().trim().min(2).max(120),
    // Strokes from the signature pad: move/line commands and numbers only, so the SVG we build can't carry markup.
    signaturePaths: z.array(z.string().regex(/^M[0-9.]+,[0-9.]+( L[0-9.]+,[0-9.]+)*$/).max(20_000)).max(200),
    capturedAt: at,
  }),
  z.object({ opId: z.string().max(64), type: z.literal("kit_issue"), kitItemId: z.uuid(), issue: z.enum(["missing", "damaged"]).nullable(), note: z.string().max(500).nullable(), capturedAt: at }),
  z.object({ opId: z.string().max(64), type: z.literal("on_my_way"), bookingId: z.uuid(), etaMinutes: z.number().int().min(1).max(600), capturedAt: at }),
  z
    .object({ opId: z.string().max(64), type: z.literal("booking_response"), bookingId: z.uuid(), response: z.enum(["accepted", "declined"]), reason: z.string().trim().max(500).nullable(), capturedAt: at })
    .refine((o) => o.response === "accepted" || Boolean(o.reason), { message: "Say why you can't do the job", path: ["reason"] }),
]);
export type SyncOp = z.infer<typeof opSchema>;
export type OpResult = { opId: string; ok: boolean; note?: string; error?: string };

async function booking(tx: Tx, id: string) {
  return tx.selectFrom("bookings").select(["id", "project_id", "company_id", "type", "status", "started_at", "completed_at"]).where("id", "=", id).executeTakeFirst();
}

/**
 * Apply one queued capture. `completed` collects projects whose install was
 * just finished, for the follow-up work that runs once the sync commits.
 */
export async function applyOp(tx: Tx, session: Session, op: SyncOp, completed: Set<string> = new Set(), followUps: (() => Promise<void>)[] = []): Promise<OpResult> {
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
      if (op.status === "completed" && !b.completed_at) await finishJob(tx, session, b, when, null, completed);
      return ok();
    }
    case "signoff": {
      const b = await booking(tx, op.bookingId);
      if (!b) return fail("Job not found");
      const already = await tx.selectFrom("bookings").select("signoff_signature_file_id").where("id", "=", b.id).executeTakeFirstOrThrow();
      let fileId = already.signoff_signature_file_id;
      if (!fileId && op.signaturePaths.length && b.project_id) {
        fileId = randomUUID();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200"><rect width="600" height="200" fill="#fff"/>${op.signaturePaths.map((d) => `<path d="${d}" stroke="#101828" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}</svg>`;
        const bytes = new TextEncoder().encode(svg);
        const path = `${session.companyId}/${b.project_id}/${fileId}.svg`;
        await fileStore().put(path, bytes, "image/svg+xml");
        await tx
          .insertInto("files")
          .values({ id: fileId, company_id: session.companyId, project_id: b.project_id, kind: "signature", path, content_type: "image/svg+xml", size_bytes: bytes.length, original_name: "signature.svg", source: "installer_app", uploaded_by: session.userId })
          .execute();
      }
      await tx.updateTable("bookings").set({ signoff_name: op.name, signoff_signature_file_id: fileId }).where("id", "=", b.id).execute();
      if (!b.completed_at) await finishJob(tx, session, b, when, op.name, completed);
      return ok();
    }
    case "kit_issue": {
      const n = await tx.updateTable("kit_items").set({ issue: op.issue, issue_note: op.note }).where("id", "=", op.kitItemId).executeTakeFirst();
      if (!n.numUpdatedRows) return fail("Kit item not found");
      if (op.issue) {
        const k = await tx.selectFrom("kit_items").select(["project_id", "company_id", "description"]).where("id", "=", op.kitItemId).executeTakeFirstOrThrow();
        await serviceNote(k.company_id, k.project_id, `${session.fullName} reported ${k.description} ${op.issue}${op.note ? `: ${op.note}` : ""}`, "kit_issue");
        followUps.push(() => notifyTeam(k.company_id, "kit_issue", { projectId: k.project_id, link: `/projects/${k.project_id}/kit`, data: { detail: `${session.fullName} reported ${k.description} ${op.issue}${op.note ? ` (${op.note})` : ""}` } }));
      }
      return ok();
    }
    case "booking_response": {
      const b = await tx.selectFrom("bookings").select(["id", "project_id", "company_id", "type", "starts_at", "ends_at", "status", "title"]).where("id", "=", op.bookingId).executeTakeFirst();
      if (!b || b.status === "cancelled") return fail("Job not found");
      const reason = op.response === "declined" ? op.reason : null;
      // A later answer replaces an earlier one; the booking's start records which dates it was for.
      await tx
        .insertInto("booking_responses")
        .values({ booking_id: b.id, user_id: session.userId, response: op.response, reason, for_starts_at: b.starts_at, responded_at: when })
        .onConflict((oc) => oc.columns(["company_id", "booking_id", "user_id"]).doUpdateSet({ response: op.response, reason, for_starts_at: b.starts_at, responded_at: when }))
        .execute();
      const p = b.project_id ? await tx.selectFrom("projects").select(["products", "site_address_line1"]).where("id", "=", b.project_id).executeTakeFirst() : null;
      const days = bookingDates(b.starts_at, b.ends_at);
      const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
      followUps.push(() =>
        notifyTeam(b.company_id, op.response === "accepted" ? "job_accepted" : "job_declined", {
          projectId: b.project_id,
          link: `/schedule?view=day&date=${days[0]}`,
          exclude: session.userId,
          data: { installer: session.fullName, detail: bookingTitle(b.type, p?.products ?? [], b.title), site: p?.site_address_line1 ?? undefined, when: days.length > 1 ? `${fmt(days[0]!)} to ${fmt(days.at(-1)!)}` : fmt(days[0]!), reason: reason ?? undefined },
        }),
      );
      return ok();
    }
    case "on_my_way": {
      const b = await booking(tx, op.bookingId);
      if (!b?.project_id) return fail("Job not found");
      // Installers can't write customer messages directly; the server does it once it knows they're on the job.
      if (Date.now() - when.getTime() > 3_600_000) return ok("too old to send");
      // Once per job every two hours (a double tap or a resend doesn't repeat it).
      const window = Math.floor(when.getTime() / 7_200_000) % 30_000;
      await withService(db(), async (s) => {
        const p = await s.selectFrom("projects").select(["id", "contact_id"]).where("id", "=", b.project_id!).where("company_id", "=", b.company_id).executeTakeFirstOrThrow();
        await notifyCustomer(s, b.company_id, "on_my_way", {
          contactId: p.contact_id,
          projectId: p.id,
          sentBy: session.userId,
          once: { entityId: b.id, step: window },
          data: { installer: firstName(session.fullName), eta: `in about ${op.etaMinutes} minutes` },
        });
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

/** Job completed in the app. For installs, paperwork and the balance invoice follow after commit (lib/completion.ts). */
async function finishJob(tx: Tx, session: Session, b: { id: string; project_id: string | null; company_id: string; type: string }, when: Date, signedBy: string | null, completed: Set<string>) {
  await tx.updateTable("bookings").set({ status: "completed", completed_at: when }).where("id", "=", b.id).execute();
  if (b.project_id) {
    const label = b.type === "install" ? "Install" : b.type === "survey" ? "Site survey" : "Job";
    if (b.type === "survey") {
      await withService(db(), (s) => s.updateTable("surveys").set({ site_visit_status: "completed", site_visit_at: when }).where("project_id", "=", b.project_id!).where("company_id", "=", b.company_id).execute());
    }
    if (b.type === "install") completed.add(b.project_id);
    await serviceNote(b.company_id, b.project_id, `${label} completed by ${session.fullName}${signedBy ? `, signed off by ${signedBy}` : ""}`, `${b.type}_completed`);
  }
}
