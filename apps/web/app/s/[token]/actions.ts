"use server";

import { normaliseAnswer, SURVEY_KINDS, surveyProgress } from "@goinstall/core";
import { sql, withService, type Tx } from "@goinstall/db";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { notifyTeam } from "@/lib/notify";
import { z } from "zod";
import { db } from "@/lib/db";
import { extensionFor, fileStore, IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/files";
import { findPublicSurvey, photoCounts, surveyConfig, surveyPhotos, type PublicSurvey } from "@/lib/survey";

export interface SurveyActionResult {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const EXPIRED = "This survey link has expired or been replaced. Ask us for a new link.";

/** Every customer action re-checks the token: the link is the only credential. */
async function withSurvey<T>(token: string, fn: (tx: Tx, s: PublicSurvey) => Promise<T>): Promise<T | { error: string }> {
  return withService(db(), async (tx) => {
    const survey = await findPublicSurvey(tx, token);
    if (!survey) return { error: EXPIRED };
    return fn(tx, survey);
  });
}

/**
 * Save the answers on one step of the form. Answers the customer hasn't
 * changed are left alone, so staff edits keep their source.
 */
async function saveAnswers(tx: Tx, s: PublicSurvey, form: FormData): Promise<SurveyActionResult> {
  const { questions } = await surveyConfig(tx, s.kind, s.products, { online: true, companyId: s.companyId });
  const current = new Map(s.fields.map((f) => [f.key, f.value]));
  const fieldErrors: Record<string, string> = {};
  const writes: { key: string; value: string | null }[] = [];
  for (const q of questions) {
    if (!form.has(`f_${q.key}`)) continue;
    const result = normaliseAnswer(q, String(form.get(`f_${q.key}`)));
    if ("error" in result) fieldErrors[q.key] = result.error;
    else if ((current.get(q.key) ?? null) !== result.value) writes.push({ key: q.key, value: result.value });
  }
  if (Object.keys(fieldErrors).length) return { error: "Please check the highlighted answers.", fieldErrors };
  for (const w of writes) {
    await tx
      .insertInto("survey_fields")
      .values({ company_id: s.companyId, survey_id: s.surveyId, key: w.key, value: w.value, source: "online", edited_by: null, created_by: null })
      .onConflict((oc) => oc.columns(["company_id", "survey_id", "key"]).doUpdateSet({ value: w.value, source: "online", edited_by: null }))
      .execute();
  }
  if (s.status === "sent" || s.status === "not_sent") {
    await tx.updateTable("surveys").set({ online_status: "in_progress" }).where("id", "=", s.surveyId).where("company_id", "=", s.companyId).execute();
  }
  return { ok: true };
}

export async function saveStepAction(token: string, _: SurveyActionResult, form: FormData): Promise<SurveyActionResult> {
  return withSurvey(token, (tx, s) => saveAnswers(tx, s, form));
}

export async function uploadSurveyPhotoAction(token: string, form: FormData): Promise<SurveyActionResult> {
  const file = form.get("photo");
  const category = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/).safeParse(form.get("category"));
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo." };
  if (!category.success) return { error: "Choose what the photo shows." };
  if (!IMAGE_TYPES.includes(file.type)) return { error: "Photos must be JPEG, PNG, WebP or HEIC." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That photo is too large." };
  const result = await withSurvey(token, async (tx, s) => {
    const { categories } = await surveyConfig(tx, s.kind, s.products, { companyId: s.companyId });
    if (!categories.some((c) => c.key === category.data)) return { error: "Choose what the photo shows." };
    const existing = await surveyPhotos(tx, s.projectId, s.companyId, s.kind);
    if (existing.filter((p) => p.source === "online_survey").length >= 40) return { error: "You've added the maximum number of photos." };
    const id = randomUUID();
    const path = `${s.companyId}/${s.projectId}/${id}.${extensionFor(file.type)}`;
    await fileStore().put(path, new Uint8Array(await file.arrayBuffer()), file.type);
    await tx
      .insertInto("files")
      .values({
        id,
        company_id: s.companyId,
        project_id: s.projectId,
        kind: "photo",
        survey_kind: s.kind,
        category: category.data,
        path,
        content_type: file.type,
        size_bytes: file.size,
        original_name: file.name.slice(0, 200),
        source: "online_survey",
        uploaded_by: null,
        created_by: null,
      })
      .execute();
    return { ok: true };
  });
  revalidatePath(`/s/${token}`);
  return result;
}

/** Customers can remove photos they added, not ones the team added. */
export async function removeSurveyPhotoAction(token: string, fileId: string): Promise<SurveyActionResult> {
  if (!z.uuid().safeParse(fileId).success) return { error: "Photo not found." };
  const result = await withSurvey(token, async (tx, s) => {
    await tx
      .updateTable("files")
      .set({ deleted_at: sql<Date>`now()` })
      .where("id", "=", fileId)
      .where("company_id", "=", s.companyId)
      .where("project_id", "=", s.projectId)
      .where("source", "=", "online_survey")
      .execute();
    return { ok: true };
  });
  revalidatePath(`/s/${token}`);
  return result;
}

/** Final step: save, check required answers, mark complete and tell the team in the thread. */
export async function submitSurveyAction(token: string, _: SurveyActionResult, form: FormData): Promise<SurveyActionResult> {
  let completed: { companyId: string; projectId: string; kind: string } | null = null;
  const result = await withSurvey(token, async (tx, s): Promise<SurveyActionResult> => {
    const saved = await saveAnswers(tx, s, form);
    if (saved.error) return saved;
    const { questions, categories } = await surveyConfig(tx, s.kind, s.products, { online: true, companyId: s.companyId });
    const fields = await tx.selectFrom("survey_fields").select(["key", "value", "source"]).where("company_id", "=", s.companyId).where("survey_id", "=", s.surveyId).execute();
    const photos = await surveyPhotos(tx, s.projectId, s.companyId, s.kind);
    const progress = surveyProgress(questions, fields, categories, photoCounts(photos));
    if (progress.missingRequired.length) {
      const labels = new Map(questions.map((q) => [q.key, q.label]));
      return {
        error: `Please answer: ${progress.missingRequired.map((k) => labels.get(k)).join(", ")}.`,
        fieldErrors: Object.fromEntries(progress.missingRequired.map((k) => [k, "Please answer this question"])),
      };
    }
    const first = s.status !== "completed";
    await tx
      .updateTable("surveys")
      .set({ online_status: "completed", online_completed_at: sql<Date>`now()` })
      .where("id", "=", s.surveyId)
      .where("company_id", "=", s.companyId)
      .execute();
    const photoTotal = photos.filter((p) => p.source === "online_survey").length;
    await tx
      .insertInto("messages")
      .values({
        company_id: s.companyId,
        contact_id: s.contactId,
        project_id: s.projectId,
        channel: "system",
        direction: "internal",
        body: `${SURVEY_KINDS[s.kind].label} ${first ? "completed online" : "updated online"} · ${progress.answered} answers, ${photoTotal} ${photoTotal === 1 ? "photo" : "photos"}`,
        created_by: null,
      })
      .execute();
    await tx
      .insertInto("activity_log")
      .values({
        company_id: s.companyId,
        project_id: s.projectId,
        contact_id: s.contactId,
        actor_id: null,
        event: first ? "online_survey_completed" : "online_survey_updated",
        payload: { kind: s.kind, answers: progress.answered, photos: photoTotal, missing_photos: progress.missingPhotos },
      })
      .execute();
    await tx.updateTable("contacts").set({ last_activity_at: sql<Date>`now()` }).where("id", "=", s.contactId).where("company_id", "=", s.companyId).execute();
    if (first) completed = { companyId: s.companyId, projectId: s.projectId, kind: SURVEY_KINDS[s.kind].label };
    return { ok: true };
  });
  const c = completed as { companyId: string; projectId: string; kind: string } | null;
  if (c) await notifyTeam(c.companyId, "survey_completed", { projectId: c.projectId, link: `/projects/${c.projectId}/survey`, data: { detail: c.kind } });
  revalidatePath(`/s/${token}`);
  return result;
}
