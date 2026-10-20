import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { setPasswordAction } from "../../actions";

export const metadata = { title: "Set your password" };

export default function SetPasswordPage() {
  return (
    <Card>
      <CardContent className="p-6">
        <h1 className="mb-4 text-lg font-semibold">Choose a password</h1>
        <ActionForm action={setPasswordAction} className="grid gap-4">
          <Field label="New password" htmlFor="password" hint="At least 10 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required aria-describedby="password-hint" />
          </Field>
          <SubmitButton>Save and continue</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
