import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { removeLogoAction, updateCompanyAction, uploadLogoAction } from "@/lib/actions/settings";
import { signedUrls } from "@/lib/files";
import { asUser } from "@/lib/auth";

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
  const logoUrl = c.logo_path ? ((await signedUrls([c.logo_path], 600)).get(c.logo_path) ?? null) : null;
  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Logo</CardTitle>
          <p className="text-sm text-ink-3">Shown at the top of your proposals, their PDFs and your invoices.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {logoUrl ? (
            <div className="flex flex-wrap items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="Your current logo" className="h-16 max-w-[220px] rounded-md border bg-white object-contain p-2" />
              <ActionForm action={removeLogoAction}>
                <SubmitButton variant="outline" size="sm" pendingText="Removing…">
                  Remove logo
                </SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No logo yet: proposals show your initials.</p>
          )}
          <ActionForm action={uploadLogoAction} className="flex flex-wrap items-end gap-3" resetOnSuccess>
            <Field label={logoUrl ? "Replace the logo" : "Upload a logo"} htmlFor="logo" hint="PNG or JPEG, up to 2 MB. A wide logo on a white or clear background works best.">
              <Input id="logo" name="logo" type="file" accept="image/png,image/jpeg" required className="w-72 py-1.5" aria-describedby="logo-hint" />
            </Field>
            <SubmitButton pendingText="Uploading…">Upload logo</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
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
            <TextField c={c} name="depot_address" label="Depot address" hint="Where kit can be delivered instead of the site." className="sm:col-span-2" />
            <TextField c={c} name="company_number" label="Company number" />
            <TextField c={c} name="vat_number" label="VAT number" />
            <TextField c={c} name="mcs_number" label="MCS certification number" />
            <TextField c={c} name="competent_person_scheme_number" label="Competent person scheme number" />
            <TextField c={c} name="brand_primary_colour" label="Brand colour" hint="Hex, e.g. #0F766E" />
            <TextField c={c} name="brand_secondary_colour" label="Second brand colour" hint="Hex, e.g. #F59E0B" />
            <Field label="About us" htmlFor="about" hint="Shown in the About section of every proposal, with your accreditations and contact details." className="sm:col-span-2">
              <Textarea id="about" name="about" rows={5} defaultValue={c.about ?? ""} aria-describedby="about-hint" placeholder="Who you are, how long you've been installing, what customers can expect." />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Save company details</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>


    </div>
  );
}
