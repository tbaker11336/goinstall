import { ActionForm, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { rotateEnquiryKeyAction, updateCompanyAction } from "@/lib/actions/settings";
import { asUser } from "@/lib/auth";
import { env } from "@/lib/env";

export const metadata = { title: "Company details" };

type Company = Awaited<ReturnType<typeof load>>;

async function load() {
  return asUser((tx, s) => tx.selectFrom("companies").selectAll().where("id", "=", s.companyId).executeTakeFirstOrThrow(), ["admin"]);
}

function TextField({ c, name, label, type = "text", hint, className }: { c: Company; name: keyof Company & string; label: string; type?: string; hint?: string; className?: string }) {
  const value = c[name];
  return (
    <Field label={label} htmlFor={name} hint={hint} className={className}>
      <Input id={name} name={name} type={type} defaultValue={typeof value === "string" ? value : ""} aria-describedby={hint ? `${name}-hint` : undefined} />
    </Field>
  );
}

export default async function CompanySettingsPage() {
  const c = await load();
  const endpoint = `${env.siteUrl}/api/public/enquiries`;
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Company details</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">Used on proposals, invoices, emails and paperwork.</p>
          <ActionForm action={updateCompanyAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name" htmlFor="name" className="sm:col-span-2">
              <Input id="name" name="name" defaultValue={c.name} required />
            </Field>
            <TextField c={c} name="website" label="Website" type="url" />
            <TextField c={c} name="phone" label="Phone" type="tel" />
            <TextField c={c} name="email" label="Email" type="email" />
            <div className="hidden sm:block" />
            <TextField c={c} name="address_line1" label="Registered address" className="sm:col-span-2" />
            <TextField c={c} name="address_line2" label="Address line 2" className="sm:col-span-2" />
            <TextField c={c} name="town" label="Town" />
            <TextField c={c} name="county" label="County" />
            <TextField c={c} name="postcode" label="Postcode" />
            <div className="hidden sm:block" />
            <TextField c={c} name="company_number" label="Company number" />
            <TextField c={c} name="vat_number" label="VAT number" />
            <TextField c={c} name="mcs_number" label="MCS certification number" />
            <TextField c={c} name="competent_person_scheme_number" label="Competent person scheme number" />
            <TextField c={c} name="brand_primary_colour" label="Brand colour" hint="Hex, e.g. #0F766E" />
            <TextField c={c} name="brand_secondary_colour" label="Second brand colour" hint="Hex, e.g. #F59E0B" />
            <div className="sm:col-span-2">
              <SubmitButton>Save company details</SubmitButton>
            </div>
          </ActionForm>
          <p className="mt-4 text-xs text-muted-foreground">Logo upload arrives once file storage is connected to your Supabase project.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Website enquiry form</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-muted-foreground">
            Post your website's enquiry form to this address and each submission creates a contact and project here. Include your form key as a field
            named <code>key</code>.
          </p>
          <dl className="grid gap-2">
            <div>
              <dt className="text-xs text-muted-foreground">Endpoint</dt>
              <dd>
                <code className="break-all">{endpoint}</code>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Form key</dt>
              <dd>
                <code data-testid="enquiry-key">{c.enquiry_form_key}</code>
              </dd>
            </div>
          </dl>
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
          <p className="text-xs text-muted-foreground">A new key stops the old one working, so update your website form at the same time.</p>
        </CardContent>
      </Card>
    </div>
  );
}
