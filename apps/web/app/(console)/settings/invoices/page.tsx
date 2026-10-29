import { CATEGORY_LABELS, formatPence, PRODUCT_CATEGORIES } from "@goinstall/core";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { connectStripeAction, saveInvoiceSettingsAction } from "@/lib/actions/invoice-settings";
import { asUser } from "@/lib/auth";
import { payments } from "@/lib/payments";

export const metadata = { title: "Invoices & quotes" };

const STRIPE_NOTES: Record<string, string> = {
  done: "Stripe returned you here. If anything is still outstanding, Stripe will ask for it when you connect again.",
  retry: "That Stripe link expired. Connect again to carry on.",
  unavailable: "Card payments aren't switched on for GoInstall yet (STRIPE_SECRET_KEY isn't set). Customers can still pay by bank transfer.",
};

export default async function InvoiceSettingsPage({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
  const { stripe } = await searchParams;
  const c = await asUser(
    (tx, s) =>
      tx
        .selectFrom("companies")
        .select([
          "vat_rates",
          "default_deposit_pct",
          "proposal_valid_days",
          "shared_visit_discount_pence",
          "document_prefix",
          "bank_account_name",
          "bank_sort_code",
          "bank_account_number",
          "payment_terms",
          "stripe_account_id",
        ])
        .where("id", "=", s.companyId)
        .executeTakeFirstOrThrow(),
    ["admin"],
  );
  const provider = payments();
  const ready = c.stripe_account_id && provider ? await provider.accountReady(c.stripe_account_id).catch(() => false) : false;
  const vat = (c.vat_rates ?? {}) as Record<string, number>;
  return (
    <>
      <ActionForm action={saveInvoiceSettingsAction} className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex-col items-start">
            <CardTitle>VAT rates</CardTitle>
            <p className="text-sm text-ink-3">
              The rate charged on each kind of line, as a percentage. GoInstall doesn&apos;t assume one: check the current rules for your installs with your
              accountant. Proposals warn when a rate they need is blank.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {PRODUCT_CATEGORIES.map((cat) => (
              <Field key={cat} label={`${CATEGORY_LABELS[cat]} (%)`} htmlFor={`vat_${cat}`}>
                <Input id={`vat_${cat}`} name={`vat_${cat}`} inputMode="decimal" defaultValue={vat[cat] ?? ""} />
              </Field>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quotes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Reference prefix" htmlFor="document_prefix" hint="Quotes show as e.g. Q-0142; invoices as Q-INV-0007.">
              <Input id="document_prefix" name="document_prefix" defaultValue={c.document_prefix ?? ""} maxLength={10} placeholder="Q" aria-describedby="document_prefix-hint" />
            </Field>
            <Field label="Days a proposal is valid" htmlFor="proposal_valid_days">
              <Input id="proposal_valid_days" name="proposal_valid_days" inputMode="numeric" defaultValue={c.proposal_valid_days ?? ""} />
            </Field>
            <Field label="Deposit (% of total)" htmlFor="default_deposit_pct">
              <Input id="default_deposit_pct" name="default_deposit_pct" inputMode="decimal" defaultValue={c.default_deposit_pct ?? ""} />
            </Field>
            <Field label="Single-visit discount (£)" htmlFor="shared_visit_discount" hint="Taken off when solar and EV are fitted on the same visit. Blank for none.">
              <Input
                id="shared_visit_discount"
                name="shared_visit_discount"
                inputMode="decimal"
                defaultValue={c.shared_visit_discount_pence === null ? "" : formatPence(Number(c.shared_visit_discount_pence)).replace("£", "")}
                aria-describedby="shared_visit_discount-hint"
              />
            </Field>
            <p className="text-sm text-ink-3 sm:col-span-2">
              Terms and conditions for proposals are under{" "}
              <Link href="/settings/terms" className="font-medium text-primary underline">
                Terms &amp; conditions
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-col items-start">
            <CardTitle>Bank transfer</CardTitle>
            <p className="text-sm text-ink-3">Shown to customers as a way to pay the deposit. You confirm transfers yourself on the Proposal tab.</p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Account name" htmlFor="bank_account_name">
              <Input id="bank_account_name" name="bank_account_name" defaultValue={c.bank_account_name ?? ""} />
            </Field>
            <Field label="Sort code" htmlFor="bank_sort_code">
              <Input id="bank_sort_code" name="bank_sort_code" inputMode="numeric" defaultValue={c.bank_sort_code ?? ""} placeholder="12-34-56" />
            </Field>
            <Field label="Account number" htmlFor="bank_account_number">
              <Input id="bank_account_number" name="bank_account_number" inputMode="numeric" defaultValue={c.bank_account_number ?? ""} />
            </Field>
            <Field label="Payment terms" htmlFor="payment_terms" className="sm:col-span-3">
              <Textarea id="payment_terms" name="payment_terms" rows={3} defaultValue={c.payment_terms ?? ""} placeholder="e.g. Balance due on completion" />
            </Field>
          </CardContent>
        </Card>
        <div>
          <SubmitButton>Save invoice and quote settings</SubmitButton>
        </div>
      </ActionForm>

      <Card>
        <CardHeader className="flex-wrap gap-2">
          <CardTitle>Card payments (Stripe)</CardTitle>
          {ready ? <Badge variant="success">Connected</Badge> : c.stripe_account_id ? <Badge variant="warning">Setup not finished</Badge> : <Badge>Not connected</Badge>}
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-ink-3">Deposits paid by card go straight to your own Stripe account. Stripe&apos;s fees apply.</p>
          {stripe && STRIPE_NOTES[stripe] && (
            <p role="status" className="rounded-md bg-muted px-3 py-2">
              {STRIPE_NOTES[stripe]}
            </p>
          )}
          <form action={connectStripeAction}>
            <Button type="submit" variant="outline" size="sm">
              {c.stripe_account_id ? "Continue Stripe setup" : "Connect Stripe"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
