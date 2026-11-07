"use server";

import { randomUUID } from "node:crypto";
import { cleanTestBoard, MAX_CIRCUITS } from "@goinstall/core";
import { sql } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { extensionFor, fileStore, IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/files";
import type { ActionResult } from "./crm";

const uuid = z.uuid();
const done = (projectId: string, message: string): ActionResult => {
  revalidatePath(`/projects/${projectId}/handover`);
  return { message };
};

/** Photos and documents the office adds to the handover (they go into the pack). */
export async function uploadHandoverFilesAction(projectId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Project not found" };
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Choose a photo or PDF to upload." };
  if (files.length > 10) return { error: "Upload up to 10 files at a time." };
  for (const f of files) {
    if (f.type !== "application/pdf" && !IMAGE_TYPES.includes(f.type)) return { error: `${f.name}: upload PDFs or photos (JPEG, PNG, WebP or HEIC).` };
    if (f.size > MAX_UPLOAD_BYTES) return { error: `${f.name} is too large (10 MB maximum).` };
  }
  return asUser(async (tx, session) => {
    const p = await tx.selectFrom("projects").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!p) return { error: "Project not found" };
    for (const f of files) {
      const id = randomUUID();
      const path = `${session.companyId}/${projectId}/${id}.${extensionFor(f.type)}`;
      await fileStore().put(path, new Uint8Array(await f.arrayBuffer()), f.type);
      await tx
        .insertInto("files")
        .values({ id, project_id: projectId, kind: f.type === "application/pdf" ? "document" : "photo", category: "handover", path, content_type: f.type, size_bytes: f.size, original_name: f.name.slice(0, 200), source: "staff", uploaded_by: session.userId })
        .execute();
    }
    return done(projectId, files.length === 1 ? `${files[0]!.name} added to the handover.` : `${files.length} files added to the handover.`);
  });
}

export async function removeHandoverFileAction(fileId: string): Promise<ActionResult> {
  if (!uuid.safeParse(fileId).success) return { error: "File not found" };
  return asUser(async (tx) => {
    const f = await tx.updateTable("files").set({ deleted_at: sql<Date>`now()` }).where("id", "=", fileId).where("category", "=", "handover").returning("project_id").executeTakeFirst();
    if (!f?.project_id) return { error: "File not found" };
    return done(f.project_id, "Removed from the handover.");
  });
}

const valuesSchema = z.record(z.string().max(40), z.string().max(200));
const boardInput = z.object({ board: valuesSchema, circuits: z.array(valuesSchema).max(MAX_CIRCUITS, `A board can have up to ${MAX_CIRCUITS} circuits.`) });

/** Save a board's details and circuit results (typed in by the office, or corrected). */
export async function saveTestBoardAction(projectId: string, boardId: string | null, input: z.infer<typeof boardInput>): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success || (boardId && !uuid.safeParse(boardId).success)) return { error: "Not found" };
  const parsed = boardInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const t = cleanTestBoard(parsed.data);
  return asUser(async (tx, session) => {
    const p = await tx.selectFrom("projects").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!p) return { error: "Project not found" };
    const values = { board: JSON.stringify(t.board), circuits: JSON.stringify(t.circuits), recorded_by: session.userId, captured_at: sql<Date>`now()` };
    if (boardId) {
      const r = await tx.updateTable("electrical_test_boards").set(values).where("id", "=", boardId).where("project_id", "=", projectId).executeTakeFirst();
      if (!r.numUpdatedRows) return { error: "Board not found" };
    } else {
      const n = await tx.selectFrom("electrical_test_boards").select(sql<number>`count(*)::int`.as("n")).where("project_id", "=", projectId).executeTakeFirstOrThrow();
      await tx.insertInto("electrical_test_boards").values({ id: randomUUID(), project_id: projectId, position: n.n, ...values }).execute();
    }
    return done(projectId, `Test results saved: ${t.circuits.length} circuit${t.circuits.length === 1 ? "" : "s"}.`);
  });
}

export async function deleteTestBoardAction(boardId: string): Promise<ActionResult> {
  if (!uuid.safeParse(boardId).success) return { error: "Board not found" };
  return asUser(async (tx) => {
    const r = await tx.deleteFrom("electrical_test_boards").where("id", "=", boardId).returning("project_id").executeTakeFirst();
    if (!r) return { error: "Board not found" };
    return done(r.project_id, "Board removed.");
  });
}
