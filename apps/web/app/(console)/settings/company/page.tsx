import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { updateCompanyAction } from "@/lib/actions/settings";
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
            <TextField c={c} name="depot_address" label="Depot address" hint="Where kit can be delivered instead of the site." className="sm:col-span-2" />
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

    </div>
  );
}
