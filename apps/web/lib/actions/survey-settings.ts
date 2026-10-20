"use server";

import { templatePlaceholders } from "@goinstall/core";
import { pgErrorCode, sql } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import type { ActionResult } from "./crm";

const PLACEHOLDERS = ["first_name", "name", "company_name", "survey_link", "sender_name", "site_address"];

const products = (form: FormData) => z.array(z.enum(["solar", "battery", "ev"])).parse(form.getAll("products").map(String));
const text = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const optionsFrom = (form: FormData) =>
  text(form, "options")
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean)
    .slice(0, 20);

/** Stable key from a label: "Main fuse rating" -> "main_fuse_rating". */
function keyFrom(label: string) {
  const k = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return /^[a-z]/.test(k) ? k : `q_${k}`;
}

const questionSchema = z.object({
  label: z.string().trim().min(1, "Enter the question").max(200),
  help: z.string().trim().max(500).transform((v) => v || null),
  section: z.string().trim().min(1, "Enter a section").max(60),
  type: z.enum(["text", "long_text", "number", "select", "yes_no"]),
});

function parseQuestion(form: FormData) {
  const parsed = questionSchema.safeParse({ label: text(form, "label"), help: text(form, "help"), section: text(form, "section"), type: text(form, "type") });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message } as const;
  const options = optionsFrom(form);
  if (parsed.data.type === "select" && options.length < 2) return { error: "A choice question needs at least two options, one per line." } as const;
  return {
    values: {
      ...parsed.data,
      options: parsed.data.type === "select" ? options : [],
      products: products(form),
      required: form.get("required") === "on",
      ask_online: form.get("ask_online") === "on",
    },
  } as const;
}

export async function updateQuestionAction(id: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = parseQuestion(form);
  if ("error" in parsed) return { error: parsed.error };
  return asUser(
    async (tx) => {
      const r = await tx.updateTable("survey_questions").set(parsed.values).where("id", "=", z.uuid().parse(id)).executeTakeFirst();
      if (!r.numUpdatedRows) return { error: "Question not found" };
      revalidatePath("/settings/surveys");
      return { message: "Question saved." };
    },
    ["admin"],
  );
}

export async function addQuestionAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = parseQuestion(form);
  if ("error" in parsed) return { error: parsed.error };
  return asUser(
    async (tx) => {
      const last = await tx.selectFrom("survey_questions").select((eb) => eb.fn.max("position").as("p")).executeTakeFirst();
      const base = keyFrom(parsed.values.label);
      for (let i = 0; i < 5; i++) {
        try {
          await tx
            .insertInto("survey_questions")
            .values({ ...parsed.values, key: i ? `${base}_${i + 1}` : base, position: (Number(last?.p) || 0) + 10 })
            .execute();
          revalidatePath("/settings/surveys");
          return { message: "Question added." };
        } catch (err) {
          if (pgErrorCode(err) !== "23505") throw err;
        }
      }
      return { error: "A question with that name already exists." };
    },
    ["admin"],
  );
}

/** Archived questions disappear from new surveys; answers already given are kept. */
export async function setQuestionArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return asUser(
    async (tx) => {
      await tx
        .updateTable("survey_questions")
        .set({ archived_at: archived ? sql<Date>`now()` : null })
        .where("id", "=", z.uuid().parse(id))
        .execute();
      revalidatePath("/settings/surveys");
      return { message: archived ? "Question archived." : "Question restored." };
    },
    ["admin"],
  );
}

const categorySchema = z.object({
  label: z.string().trim().min(1, "Enter a name").max(100),
  help: z.string().trim().max(300).transform((v) => v || null),
});

export async function savePhotoCategoryAction(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = categorySchema.safeParse({ label: text(form, "label"), help: text(form, "help") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const values = { ...parsed.data, products: products(form), required: form.get("required") === "on" };
  return asUser(
    async (tx) => {
      if (id) {
        await tx.updateTable("photo_categories").set(values).where("id", "=", z.uuid().parse(id)).execute();
      } else {
        const last = await tx.selectFrom("photo_categories").select((eb) => eb.fn.max("position").as("p")).executeTakeFirst();
        try {
          await tx
            .insertInto("photo_categories")
            .values({ ...values, key: keyFrom(values.label), position: (Number(last?.p) || 0) + 10 })
            .execute();
        } catch (err) {
          if (pgErrorCode(err) === "23505") return { error: "A photo type with that name already exists." };
          throw err;
        }
      }
      revalidatePath("/settings/surveys");
      return { message: id ? "Photo type saved." : "Photo type added." };
    },
    ["admin"],
  );
}

export async function setPhotoCategoryArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return asUser(
    async (tx) => {
      await tx
        .updateTable("photo_categories")
        .set({ archived_at: archived ? sql<Date>`now()` : null })
        .where("id", "=", z.uuid().parse(id))
        .execute();
      revalidatePath("/settings/surveys");
      return { message: archived ? "Photo type archived." : "Photo type restored." };
    },
    ["admin"],
  );
}

const templateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  subject: z.string().trim().min(1, "Enter a subject").max(200),
  body: z.string().trim().min(1, "Write the message").max(10_000),
});

/** Save an email template (the survey link template, or one of the team's own). */
export async function saveTemplateAction(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = templateSchema.safeParse({ name: text(form, "name"), subject: text(form, "subject"), body: text(form, "body") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const unknown = templatePlaceholders(`${parsed.data.subject}\n${parsed.data.body}`).filter((p) => !PLACEHOLDERS.includes(p));
  if (unknown.length) return { error: `Unknown placeholder: {{${unknown[0]}}}. Use ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}.` };
  return asUser(
    async (tx) => {
      if (id) {
        const t = await tx.selectFrom("message_templates").select(["key"]).where("id", "=", z.uuid().parse(id)).executeTakeFirst();
        if (!t) return { error: "Template not found" };
        if (t.key === "survey_link" && !parsed.data.body.includes("{{survey_link}}")) return { error: "The survey email must include {{survey_link}}." };
        await tx.updateTable("message_templates").set(parsed.data).where("id", "=", id).execute();
      } else {
        await tx.insertInto("message_templates").values({ ...parsed.data, channel: "email" }).execute();
      }
      revalidatePath("/settings/surveys");
      return { message: "Template saved." };
    },
    ["admin"],
  );
}

export async function archiveTemplateAction(id: string): Promise<ActionResult> {
  return asUser(
    async (tx) => {
      // App templates (with a key) can be edited but not removed.
      await tx.updateTable("message_templates").set({ archived_at: sql<Date>`now()` }).where("id", "=", z.uuid().parse(id)).where("key", "is", null).execute();
      revalidatePath("/settings/surveys");
      return { message: "Template removed." };
    },
    ["admin"],
  );
}
