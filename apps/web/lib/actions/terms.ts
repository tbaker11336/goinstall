"use server";

import { randomUUID } from "node:crypto";
import { sql } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/auth";
import { fileStore } from "@/lib/files";
import type { ActionResult } from "./crm";

/** Server actions accept up to 4 MB (next.config.ts). */
const MAX_TERMS_BYTES = 4 * 1024 * 1024;

/** The terms text shown on every proposal and accepted with it. */
export async function saveTermsTextAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const text = String(form.get("terms_and_conditions") ?? "").trim().slice(0, 50_000) || null;
  return asUser(
    async (tx, session) => {
      await tx.updateTable("companies").set({ terms_and_conditions: text }).where("id", "=", session.companyId).execute();
      await tx.updateTable("proposals").set({ terms: text }).where("company_id", "=", session.companyId).where("status", "=", "draft").execute();
      revalidatePath("/settings/terms");
      return { message: "Terms saved. New and draft proposals use them; sent proposals keep the terms they were sent with." };
    },
    ["admin"],
  );
}

/** Upload the company's terms as a PDF; it replaces the previous one for new and draft proposals. */
export async function uploadTermsFileAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF to upload." };
  if (file.type !== "application/pdf") return { error: "Upload the terms as a PDF." };
  if (file.size > MAX_TERMS_BYTES) return { error: "That PDF is too large (4 MB maximum)." };
  return asUser(
    async (tx, session) => {
      const id = randomUUID();
      const path = `${session.companyId}/terms/${id}.pdf`;
      await fileStore().put(path, new Uint8Array(await file.arrayBuffer()), file.type);
      await tx
        .insertInto("files")
        .values({ id, project_id: null, kind: "document", category: "terms", path, content_type: file.type, size_bytes: file.size, original_name: file.name.slice(0, 200), source: "staff", uploaded_by: session.userId })
        .execute();
      await tx.updateTable("companies").set({ terms_file_id: id }).where("id", "=", session.companyId).execute();
      await useTermsOnDrafts(tx, session.companyId);
      revalidatePath("/settings/terms");
      return { message: `${file.name} attached to your proposals.` };
    },
    ["admin"],
  );
}

/** Stop attaching the PDF to new proposals (sent ones keep theirs). */
export async function removeTermsFileAction(): Promise<ActionResult> {
  return asUser(
    async (tx, session) => {
      await tx.updateTable("companies").set({ terms_file_id: null }).where("id", "=", session.companyId).execute();
      await useTermsOnDrafts(tx, session.companyId);
      revalidatePath("/settings/terms");
      return { message: "Terms PDF removed from new proposals." };
    },
    ["admin"],
  );
}

async function useTermsOnDrafts(tx: Parameters<Parameters<typeof asUser>[0]>[0], companyId: string) {
  await tx
    .updateTable("proposals")
    .set({ terms_file_id: sql`(select terms_file_id from public.companies where id = ${companyId})` })
    .where("company_id", "=", companyId)
    .where("status", "=", "draft")
    .execute();
}
