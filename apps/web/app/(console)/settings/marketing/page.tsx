import { embedSnippet, enquiryFormConfig, FIELD_LABELS, OPTIONAL_FIELDS } from "@goinstall/core";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { saveEnquiryFormAction } from "@/lib/actions/marketing";
import { rotateEnquiryKeyAction } from "@/lib/actions/settings";
import { asUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { CopyField } from "./copy-field";

export const metadata = { title: "Marketing" };

const PRODUCTS = [
  ["solar", "Solar panels"],
  ["battery", "Battery"],
  ["ev", "EV charger"],
] as const;

export default async function MarketingSettingsPage() {
  const c = await asUser((tx, s) => tx.selectFrom("companies").select(["enquiry_form_key", "enquiry_form"]).where("id", "=", s.companyId).executeTakeFirstOrThrow(), ["admin"]);
  const config = enquiryFormConfig(c.enquiry_form);
  const base = env.siteUrl.replace(/\/$/, "");
  const formUrl = `${base}/f/${c.enquiry_form_key}`;
  const endpoint = `${base}/api/public/enquiries`;
  return (
    <>
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Website enquiry form</CardTitle>
          <p className="text-sm text-ink-3">
            Build a form here and add it to your website. Each enquiry becomes a contact and a project in GoInstall, ready to send a survey.
          </p>
        </CardHeader>
        <CardContent className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <ActionForm action={saveEnquiryFormAction} className="flex flex-col gap-4">
            <Field label="Heading" htmlFor="heading">
              <Input id="heading" name="heading" defaultValue={config.heading} maxLength={120} required />
            </Field>
            <Field label="Introduction" htmlFor="intro">
              <Textarea id="intro" name="intro" rows={2} defaultValue={config.intro} maxLength={500} />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-semibold text-ink-2">Fields (name and email are always asked)</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {OPTIONAL_FIELDS.map((k) => (
                  <Field key={k} label={FIELD_LABELS[k]} htmlFor={`field_${k}`}>
                    <Select id={`field_${k}`} name={`field_${k}`} defaultValue={config.fields[k]}>
                      <option value="required">Required</option>
                      <option value="optional">Optional</option>
                      <option value="hidden">Don&apos;t ask</option>
                    </Select>
                  </Field>
                ))}
              </div>
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-semibold text-ink-2">Products visitors can choose (untick all to not ask)</legend>
              <div className="flex flex-wrap gap-4">
                {PRODUCTS.map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="products" value={v} defaultChecked={config.products.includes(v)} className="size-4 accent-[var(--primary)]" /> {l}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Button text" htmlFor="buttonText">
                <Input id="buttonText" name="buttonText" defaultValue={config.buttonText} maxLength={40} required />
              </Field>
              <Field label="Thank-you message" htmlFor="thankYou">
                <Input id="thankYou" name="thankYou" defaultValue={config.thankYou} maxLength={300} required />
              </Field>
            </div>
            <div>
              <SubmitButton>Save form</SubmitButton>
            </div>
          </ActionForm>
          <section aria-labelledby="preview-title" className="flex flex-col gap-2">
            <h3 id="preview-title" className="text-sm font-bold">
              Preview
            </h3>
            {/* Refreshes after saving. Sending is turned off in the preview. */}
            <iframe key={JSON.stringify(config)} src={`/f/${c.enquiry_form_key}?embed=1&preview=1`} title="Enquiry form preview" className="h-[640px] w-full rounded-[10px] border bg-background" />
          </section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Add it to your website</CardTitle>
          <p className="text-sm text-ink-3">Paste this where the form should appear (most website builders have an &ldquo;Embed&rdquo; or &ldquo;HTML&rdquo; block). Or share the direct link, for example in social posts.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CopyField id="embed-code" label="Embed code" value={embedSnippet(base, c.enquiry_form_key)} multiline />
          <CopyField id="form-link" label="Direct link" value={formUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Or connect your own form</CardTitle>
          <p className="text-sm text-ink-3">
            Already have a form on your site? Post it to this address with your form key as a field named <code>key</code>.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <CopyField id="endpoint" label="Endpoint" value={endpoint} />
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink-2">Form key</span>
            <code data-testid="enquiry-key">{c.enquiry_form_key}</code>
          </div>
          <details>
            <summary className="cursor-pointer font-medium text-primary">Example HTML form</summary>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">{`<form method="post" action="${endpoint}">
  <input type="hidden" name="key" value="${c.enquiry_form_key}">
  <input type="hidden" name="redirect" value="https://your-site/thanks">
  <input name="name" required> <input name="email" type="email">
  <input name="phone"> <input name="postcode">
  <label><input type="checkbox" name="products" value="solar"> Solar</label>
  <label><input type="checkbox" name="products" value="battery"> Battery</label>
  <label><input type="checkbox" name="products" value="ev"> EV charger</label>
  <textarea name="message"></textarea>
  <button>Send</button>
</form>`}</pre>
          </details>
          <form action={rotateEnquiryKeyAction}>
            <Button type="submit" variant="outline" size="sm">
              Generate a new key
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">A new key stops the old one working, for both the embedded form and your own form, so update your website at the same time.</p>
        </CardContent>
      </Card>
    </>
  );
}
