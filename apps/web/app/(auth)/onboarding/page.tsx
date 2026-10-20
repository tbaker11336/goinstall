import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { getAuthUser, getSession } from "@/lib/auth";
import { devAuthEnabled } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { createCompanyAction } from "../actions";

export const metadata = { title: "Set up your company" };

export default async function OnboardingPage() {
  const authUser = await getAuthUser();
  if (!authUser) redirect("/login");
  if (await getSession()) redirect("/dashboard");

  let meta: { full_name?: string; company_name?: string } = {};
  if (!devAuthEnabled()) {
    const { data } = await (await supabaseServer()).auth.getUser();
    meta = data.user?.user_metadata ?? {};
  }

  return (
    <Card>
      <CardContent className="p-6">
        <h1 className="mb-1 text-lg font-semibold">Set up your company</h1>
        <p className="mb-4 text-sm text-muted-foreground">You can add your logo, VAT and MCS numbers next.</p>
        <ActionForm action={createCompanyAction} className="grid gap-4">
          <Field label="Company name" htmlFor="companyName">
            <Input id="companyName" name="companyName" defaultValue={meta.company_name} required />
          </Field>
          <Field label="Your name" htmlFor="fullName">
            <Input id="fullName" name="fullName" defaultValue={meta.full_name} required />
          </Field>
          <Field label="Your phone (optional)" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" autoComplete="tel" />
          </Field>
          <SubmitButton pendingText="Setting up…">Continue</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
