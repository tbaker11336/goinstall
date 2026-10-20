import { z } from "zod";
import { preflight, withAppUser } from "@/lib/app-auth";
import { extensionFor, fileStore, IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/files";

export const OPTIONS = preflight;

const meta = z.object({ id: z.uuid(), bookingId: z.uuid(), kind: z.enum(["photo", "signature"]), category: z.union([z.literal(""), z.string().regex(/^[a-z][a-z0-9_]{1,62}$/)]).optional(), surveyKind: z.enum(["", "solar_battery", "ev"]).optional() });

/** Upload a photo or signature captured in the app. The id is made on the device, so retries don't duplicate. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const parsed = meta.safeParse(form ? Object.fromEntries([...form.entries()].filter(([k]) => k !== "file")) : {});
  if (!parsed.success || !(file instanceof File)) return Response.json({ error: "Bad request" }, { status: 400 });
  if (!IMAGE_TYPES.includes(file.type)) return Response.json({ error: "Photos must be JPEG, PNG, WebP or HEIC" }, { status: 415 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "Too large" }, { status: 413 });
  return withAppUser(request, async (tx, session) => {
    const existing = await tx.selectFrom("files").select("id").where("id", "=", parsed.data.id).executeTakeFirst();
    if (existing) return Response.json({ id: existing.id, duplicate: true });
    const b = await tx.selectFrom("bookings").select(["project_id"]).where("id", "=", parsed.data.bookingId).executeTakeFirst();
    if (!b?.project_id) return Response.json({ error: "Job not found" }, { status: 404 });
    const path = `${session.companyId}/${b.project_id}/${parsed.data.id}.${extensionFor(file.type)}`;
    await fileStore().put(path, new Uint8Array(await file.arrayBuffer()), file.type);
    await tx
      .insertInto("files")
      .values({
        id: parsed.data.id,
        company_id: session.companyId,
        project_id: b.project_id,
        kind: parsed.data.kind,
        category: parsed.data.category || null,
        survey_kind: parsed.data.surveyKind || null,
        path,
        content_type: file.type,
        size_bytes: file.size,
        original_name: file.name.slice(0, 200) || `${parsed.data.kind}.${extensionFor(file.type)}`,
        source: "installer_app",
        uploaded_by: session.userId,
      })
      .execute();
    return Response.json({ id: parsed.data.id });
  });
}
