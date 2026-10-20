import { withService } from "@goinstall/db";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { devAuthEnabled } from "@/lib/env";
import { devSignInAction, signInAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (devAuthEnabled()) return <DevLogin />;
  return (
    <Card>
      <CardContent className="p-6">
        <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
        <ActionForm action={signInAction} className="grid gap-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          New installer company?{" "}
          <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

async function DevLogin() {
  const users = await withService(db(), (tx) =>
    tx
      .selectFrom("users")
      .innerJoin("companies", "companies.id", "users.company_id")
      .select(["users.id", "users.full_name", "users.role", "companies.name as company"])
      .where("users.is_active", "=", true)
      .orderBy("companies.name")
      .orderBy("users.role")
      .execute(),
  );
  return (
    <Card>
      <CardContent className="p-6">
        <h1 className="text-lg font-semibold">Dev sign-in</h1>
        <p className="mb-4 text-sm text-muted-foreground">Local development only. Pick a seeded user.</p>
        <ul className="grid gap-2">
          {users.map((u) => (
            <li key={u.id}>
              <form action={devSignInAction}>
                <input type="hidden" name="userId" value={u.id} />
                <Button type="submit" variant="outline" className="h-auto w-full justify-between py-2 text-left">
                  <span>
                    <span className="block">{u.full_name}</span>
                    <span className="block text-xs text-muted-foreground">{u.company}</span>
                  </span>
                  <span className="text-xs capitalize text-muted-foreground">{u.role}</span>
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
