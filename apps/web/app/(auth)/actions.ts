"use server";

import { withService } from "@goinstall/db";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createDevSession, getAuthUser, getSession, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { devAuthEnabled, env } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export interface FormState {
  error?: string;
  message?: string;
}

export async function signInAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({ email: z.email(), password: z.string().min(1) })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "That email and password don't match an account." };
  redirect("/dashboard");
}

export async function devSignInAction(form: FormData) {
  if (!devAuthEnabled()) throw new Error("Dev sign-in is disabled");
  const userId = z.uuid().parse(form.get("userId"));
  await createDevSession(userId);
  redirect("/dashboard");
}

export async function signUpAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({
      fullName: z.string().trim().min(1),
      companyName: z.string().trim().min(1),
      email: z.email(),
      password: z.string().min(10),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Fill in every field. Passwords need at least 10 characters." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${env.siteUrl}/auth/callback?next=/onboarding`,
      data: { full_name: parsed.data.fullName, company_name: parsed.data.companyName },
    },
  });
  if (error) return { error: error.message };
  return { message: "Check your email for a link to confirm your address, then you can set up your company." };
}

/**
 * Create the company and its first admin for a signed-in user who has no
 * profile yet. Uses the service role because the user has no company to pass
 * RLS checks with.
 */
export async function createCompanyAction(_: FormState, form: FormData): Promise<FormState> {
  const authUser = await getAuthUser();
  if (!authUser) redirect("/login");
  if (await getSession()) redirect("/dashboard");

  const parsed = z
    .object({
      companyName: z.string().trim().min(1, "Enter your company name"),
      fullName: z.string().trim().min(1, "Enter your name"),
      phone: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  await withService(db(), async (tx) => {
    const company = await tx
      .insertInto("companies")
      .values({ name: parsed.data.companyName, created_by: authUser.id })
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("users")
      .values({
        id: authUser.id,
        company_id: company.id,
        full_name: parsed.data.fullName,
        email: authUser.email ?? "",
        phone: parsed.data.phone || null,
        role: "admin",
        created_by: authUser.id,
      })
      .execute();
  });
  // First step after sign-up: connect the company's own email domain (skippable).
  redirect("/settings/email?welcome=1");
}

export async function setPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  if (password.length < 10) return { error: "Use at least 10 characters." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/dashboard");
}

export async function signOutAction() {
  await signOut();
  redirect("/login");
}
