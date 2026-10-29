import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { removeTermsFileAction, saveTermsTextAction, uploadTermsFileAction } from "@/lib/actions/terms";
import { asUser } from "@/lib/auth";
import { signedUrls } from "@/lib/files";

export const metadata = { title: "Terms & conditions" };

export default async function TermsSettingsPage() {
  const c = await asUser(
    (tx, s) =>
      tx
        .selectFrom("companies as co")
        .leftJoin("files as f", (j) => j.onRef("f.id", "=", "co.terms_file_id").onRef("f.company_id", "=", "co.id"))
        .select(["co.terms_and_conditions", "f.path", "f.original_name", "f.size_bytes", "f.created_at"])
        .where("co.id", "=", s.companyId)
        .executeTakeFirstOrThrow(),
    ["admin"],
  );
  const url = c.path ? (await signedUrls([c.path], 600)).get(c.path) : null;

  return (
    <>
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Terms and conditions PDF</CardTitle>
          <p className="text-sm text-ink-3">
            Attached to every proposal you send, and linked on the customer&apos;s proposal page. Customers accept it when they sign. A sent proposal keeps the version it was sent with.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {c.path ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3">
              <div className="text-sm">
                <p className="font-medium">{c.original_name ?? "Terms and conditions.pdf"}</p>
                <p className="text-xs text-muted-foreground">
                  {Math.max(1, Math.round(Number(c.size_bytes) / 1024))} KB · uploaded {c.created_at?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {url && (
                  <a href={url} target="_blank" rel="noopener" className="text-sm font-medium text-primary underline">
                    View
                  </a>
                )}
                <ActionForm action={removeTermsFileAction}>
                  <SubmitButton variant="outline" size="sm" pendingText="Removing…">
                    Remove
                  </SubmitButton>
                </ActionForm>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No PDF attached yet.</p>
          )}
          <ActionForm action={uploadTermsFileAction} className="flex flex-wrap items-end gap-3" resetOnSuccess>
            <Field label={c.path ? "Replace with a new PDF" : "Upload a PDF"} htmlFor="terms-file" hint="PDF only, up to 4 MB.">
              <Input id="terms-file" name="file" type="file" accept="application/pdf" required className="w-72 py-1.5" aria-describedby="terms-file-hint" />
            </Field>
            <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Terms text</CardTitle>
          <p className="text-sm text-ink-3">Optional. Shown at the end of every proposal and its PDF. With a PDF attached, use this for a short summary, or leave it blank.</p>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveTermsTextAction} className="flex flex-col gap-4">
            <Field label="Terms and conditions" htmlFor="terms_and_conditions">
              <Textarea id="terms_and_conditions" name="terms_and_conditions" rows={10} defaultValue={c.terms_and_conditions ?? ""} />
            </Field>
            <div>
              <SubmitButton pendingText="Saving…">Save terms</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </>
  );
}
