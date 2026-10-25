"use server";

import { randomUUID } from "node:crypto";
import { ukMobileE164 } from "@goinstall/core";
import { pgErrorCode, sql, withService } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { devAuthEnabled, env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

export interface ActionResult {
  error?: string;
  message?: string;
}

const ADMIN = ["admin"] as const;
const text = z
  .string()
  .trim()
  .transform((v) => v || null)
  .optional();
const colour = z
  .string()
  .trim()
  .transform((v) => v || null)
  .refine((v) => v === null || /^#[0-9a-fA-F]{6}$/.test(v), "Colours must look like #0F766E")
  .optional();

const companySchema = z.object({
  name: z.string().trim().min(1, "Enter the company name"),
  website: text,
  phone: text,
  email: z
    .union([z.literal(""), z.email("Enter a valid email address")])
    .optional()
    .transform((v) => v || null),
  address_line1: text,
  address_line2: text,
  town: text,
  county: text,
  postcode: text.transform((v) => v?.toUpperCase() ?? null),
  depot_address: text,
  company_number: text,
  vat_number: text,
  mcs_number: text,
  competent_person_scheme_number: text,
  brand_primary_colour: colour,
  brand_secondary_colour: colour,
});

export async function updateCompanyAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = companySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  await asUser(
    (tx, session) => tx.updateTable("companies").set(parsed.data).where("id", "=", session.companyId).execute(),
    [...ADMIN],
  );
  revalidatePath("/", "layout");
  return { message: "Company details saved." };
}

export async function rotateEnquiryKeyAction() {
  await asUser(
    (tx, session) =>
      tx
        .updateTable("companies")
        .set({ enquiry_form_key: sql`replace(gen_random_uuid()::text, '-', '')` })
        .where("id", "=", session.companyId)
        .execute(),
    [...ADMIN],
  );
  revalidatePath("/settings/marketing");
}

const roleSchema = z.enum(["admin", "office", "installer", "subcontractor"]);
const teamId = z
  .union([z.literal(""), z.uuid()])
  .optional()
  .transform((v) => v || null);

const inviteSchema = z.object({
  email: z.email("Enter a valid email address").transform((v) => v.toLowerCase()),
  full_name: z.string().trim().min(1, "Enter their name"),
  role: roleSchema,
  team_id: teamId,
});

/**
 * Invite a colleague: Supabase sends the invite email and the user row is
 * created in the admin's company straight away. In local dev the auth user
 * is created directly.
 */
export async function inviteUserAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = inviteSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { email, full_name, role, team_id } = parsed.data;

  const existing = await withService(db(), (tx) => tx.selectFrom("users").select("company_id").where(sql`lower(email)`, "=", email).executeTakeFirst());
  if (existing) return { error: existing.company_id === session.companyId ? "That person is already on your team." : "That email already belongs to another company's account." };

  let authUserId: string;
  if (devAuthEnabled()) {
    authUserId = randomUUID();
    await withService(db(), (tx) => sql`insert into auth.users (id, email) values (${authUserId}, ${email})`.execute(tx));
  } else {
    const { data, error } = await supabaseAdmin().auth.admin.inviteUserByEmail(email, {
      redirectTo: `${env.siteUrl}/auth/callback?next=/auth/set-password`,
      data: { full_name },
    });
    if (error || !data.user) return { error: error?.message ?? "The invite could not be sent." };
    authUserId = data.user.id;
  }

  try {
    // Insert as the admin so RLS confirms the team belongs to this company.
    await asUser(
      (tx) =>
        tx
          .insertInto("users")
          .values({ id: authUserId, company_id: session.companyId, email, full_name, role, team_id, created_by: session.userId })
          .execute(),
      [...ADMIN],
    );
  } catch (err) {
    if (pgErrorCode(err) === "23503") return { error: "That team doesn't exist." };
    throw err;
  }
  revalidatePath("/settings/team");
  return { message: devAuthEnabled() ? `${full_name} added (dev mode: no email sent).` : `Invite sent to ${email}.` };
}

const memberSchema = z.object({
  role: roleSchema,
  team_id: teamId,
  is_active: z.enum(["true", "false"]).transform((v) => v === "true"),
  // For text notifications; blank clears it.
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || ukMobileE164(v) !== null, "Enter a UK mobile number, e.g. 07700 900123"),
});

export async function updateMemberAction(userId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = memberSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues.find((i) => i.path[0] === "phone")?.message ?? "Check the role and team." };
  const id = z.uuid().parse(userId);
  return asUser(
    async (tx, session) => {
      const losingAdmin = parsed.data.role !== "admin" || !parsed.data.is_active;
      if (losingAdmin) {
        const admins = await tx
          .selectFrom("users")
          .select("id")
          .where("role", "=", "admin")
          .where("is_active", "=", true)
          .where("company_id", "=", session.companyId)
          .execute();
        if (admins.length === 1 && admins[0]!.id === id) return { error: "Your company needs at least one active admin." };
      }
      const r = await tx.updateTable("users").set(parsed.data).where("id", "=", id).executeTakeFirst();
      if (!Number(r.numUpdatedRows)) return { error: "User not found." };
      revalidatePath("/settings/team");
      return { message: "Saved." };
    },
    [...ADMIN],
  );
}

export async function createTeamAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = z
    .object({ name: z.string().trim().min(1, "Enter a team name"), colour })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    await asUser((tx) => tx.insertInto("teams").values(parsed.data).execute(), [...ADMIN]);
  } catch (err) {
    if (pgErrorCode(err) === "23505") return { error: "You already have a team with that name." };
    throw err;
  }
  revalidatePath("/settings/team");
  return { message: `Team "${parsed.data.name}" created.` };
}

export async function deleteTeamAction(teamId: string) {
  await asUser((tx) => tx.deleteFrom("teams").where("id", "=", z.uuid().parse(teamId)).execute(), [...ADMIN]);
  revalidatePath("/settings/team");
}
