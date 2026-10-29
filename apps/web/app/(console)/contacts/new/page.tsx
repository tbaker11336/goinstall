import { ContactFields, ProductCheckboxes } from "@/components/contact-fields";
import { PageHeader } from "@/components/domain";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/input";
import { createEnquiryAction } from "@/lib/actions/crm";
import { asUser } from "@/lib/auth";
import { listStaff } from "@/lib/queries";

export const metadata = { title: "New enquiry" };

export default async function NewEnquiryPage() {
  const staff = await asUser((tx) => listStaff(tx));
  return (
    <div className="max-w-2xl">
      <PageHeader title="New enquiry" description="Creates the contact and their first project. The site address starts as the contact's address." />
      <Card>
        <CardContent className="p-6">
          <ActionForm action={createEnquiryAction} className="grid gap-6">
            <ContactFields staff={staff} withLocation />
            <ProductCheckboxes />
            <Field label="Notes (optional)" htmlFor="note">
              <Textarea id="note" name="note" placeholder="What they asked for, best time to call…" />
            </Field>
            <div>
              <SubmitButton pendingText="Creating…">Create enquiry</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
