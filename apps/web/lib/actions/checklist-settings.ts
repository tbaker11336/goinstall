"use server";

import { parseReadings } from "@goinstall/core";
import { sql } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import type { ActionResult } from "./crm";

const stepSchema = z.object({
  kind: z.enum(["install", "handover"]),
  product: z.enum(["solar", "battery", "ev", "general"]),
  title: z.string().trim().min(1, "Give the step a name").max(200),
  help: z.string().trim().max(500).transform((v) => v || null),
  position: z.coerce.number().int().min(0).max(10000),
  requires_photo: z.literal("on").optional(),
  requires_serial: z.literal("on").optional(),
  readings: z.string().max(2000),
});

/** Save a checklist step. Saving marks a drafted starter step as reviewed. */
export async function saveChecklistStepAction(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (id && !z.uuid().safeParse(id).success) return { error: "Step not found" };
  const parsed = stepSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const values = {
    kind: d.kind,
    product: d.product,
    title: d.title,
    help: d.help,
    position: d.position,
    requires_photo: Boolean(d.requires_photo),
    requires_serial: Boolean(d.requires_serial),
    readings: JSON.stringify(parseReadings(d.readings)),
    is_draft: false,
  };
  return asUser(async (tx) => {
    if (id) await tx.updateTable("checklist_templates").set(values).where("id", "=", id).execute();
    else await tx.insertInto("checklist_templates").values(values).execute();
    revalidatePath("/settings/checklists");
    return { message: id ? "Step saved." : "Step added." };
  }, ["admin"]);
}

export async function archiveChecklistStepAction(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { error: "Step not found" };
  return asUser(async (tx) => {
    await tx.updateTable("checklist_templates").set({ archived_at: sql<Date>`now()` }).where("id", "=", id).execute();
    revalidatePath("/settings/checklists");
    return {};
  }, ["admin"]);
}
