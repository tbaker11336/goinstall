import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { signUpAction } from "../actions";

export const metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <Card>
      <CardContent className="p-6">
        <h1 className="mb-1 text-lg font-semibold">Create your company account</h1>
        <p className="mb-4 text-sm text-muted-foreground">You'll be the admin and can invite your team afterwards.</p>
        <ActionForm action={signUpAction} className="grid gap-4">
          <Field label="Your name" htmlFor="fullName">
            <Input id="fullName" name="fullName" autoComplete="name" required />
          </Field>
          <Field label="Company name" htmlFor="companyName">
            <Input id="companyName" name="companyName" autoComplete="organization" required />
          </Field>
          <Field label="Work email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 10 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required aria-describedby="password-hint" />
          </Field>
          <SubmitButton pendingText="Creating…">Create account</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
