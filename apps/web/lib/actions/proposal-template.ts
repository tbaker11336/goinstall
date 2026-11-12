"use server";

import { randomUUID } from "node:crypto";
import { normaliseTemplate, templateFileIds } from "@goinstall/core";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/auth";
import { fileStore, signedUrls } from "@/lib/files";
import type { ActionResult } from "./crm";

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Save the cover and pages (Settings › Proposal). Images must be the company's own uploads. */
export async function saveProposalTemplateAction(raw: unknown): Promise<ActionResult> {
  const t = normaliseTemplate(raw);
  return asUser(
    async (tx, session) => {
      const ids = templateFileIds(t);
      const mine = new Set(ids.length ? (await tx.selectFrom("files").select("id").where("id", "in", ids).where("category", "=", "proposal_template").where("deleted_at", "is", null).execute()).map((f) => f.id) : []);
      const keep = (id: string | null) => (id && mine.has(id) ? id : null);
      t.cover.imageFileId = keep(t.cover.imageFileId);
      for (const p of t.pages) {
        p.work = p.work.map((w) => ({ ...w, photoFileId: keep(w.photoFileId) }));
        p.accreditations = p.accreditations.map((a) => ({ ...a, logoFileId: keep(a.logoFileId) }));
      }
      await tx.updateTable("companies").set({ proposal_template: JSON.stringify(t) }).where("id", "=", session.companyId).execute();
      revalidatePath("/settings/proposal");
      return { message: "Proposal template saved. Draft proposals use it now; sent ones keep the version they were sent with." };
    },
    ["admin"],
  );
}

/** An image for the cover, featured work or an accreditation logo (PNG or JPEG, so it also goes in the PDF). */
export async function uploadTemplateImageAction(form: FormData): Promise<{ error?: string; fileId?: string; url?: string }> {
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image." };
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return { error: "Use a JPEG or PNG image." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "That image is too large (4 MB maximum)." };
  return asUser(
    async (tx, session) => {
      const id = randomUUID();
      const path = `${session.companyId}/branding/template-${id}.${ext}`;
      await fileStore().put(path, new Uint8Array(await file.arrayBuffer()), file.type);
      await tx
        .insertInto("files")
        .values({ id, project_id: null, kind: "photo", category: "proposal_template", path, content_type: file.type, size_bytes: file.size, original_name: file.name.slice(0, 200), source: "staff", uploaded_by: session.userId })
        .execute();
      return { fileId: id, url: (await signedUrls([path], 3600)).get(path) ?? undefined };
    },
    ["admin"],
  );
}
