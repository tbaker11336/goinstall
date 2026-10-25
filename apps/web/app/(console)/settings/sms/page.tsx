import { formatPence, smsUsage } from "@goinstall/core";
import { withService } from "@goinstall/db";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { saveSmsBusinessDetailsAction, smsBillingPortalAction, startSmsSubscriptionAction } from "@/lib/actions/sms";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { smsPlan, smsService, smsUsed } from "@/lib/sms";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "SMS add-on" };

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "danger" | "default" }> = {
  checkout: { label: "Not set up", variant: "default" },
  pending_number: { label: "Setting up your number", variant: "warning" },
  active: { label: "Active", variant: "success" },
  past_due: { label: "Payment failed", variant: "danger" },
  cancelled: { label: "Cancelled", variant: "default" },
};

export default async function SmsSettingsPage({ searchParams }: { searchParams: Promise<{ subscribed?: string }> }) {
  const session = await requireAdmin();
  const { subscribed } = await searchParams;
  const plan = smsPlan();
  // Admin-only page; billing fields are read server-side for this company only.
  const { account, company, used } = await withService(db(), async (tx) => {
    const account = await tx.selectFrom("sms_accounts").selectAll().where("company_id", "=", session.companyId).executeTakeFirst();
    const company = await tx.selectFrom("companies").select(["name", "company_number", "address_line1", "address_line2", "town", "postcode", "email", "phone"]).where("id", "=", session.companyId).executeTakeFirstOrThrow();
    const used = account?.status === "active" ? (await smsUsed(tx, session.companyId, account.current_period_start)) + account.staff_texts_this_period : 0;
    return { account, company, used };
  });
  const status = account?.status ?? "checkout";
  const details = (account?.business_details ?? {}) as Record<string, string>;
  const usage = plan ? smsUsage(plan, used) : null;

  return (
    <>
      <Card>
        <CardHeader className="flex-col items-start">
          <div className="flex w-full items-center justify-between gap-2">
            <CardTitle>SMS add-on</CardTitle>
            <Badge variant={STATUS[status]!.variant}>{STATUS[status]!.label}</Badge>
          </div>
          <p className="text-sm text-ink-3">
            Your own UK mobile number for texts to customers (reminders, &ldquo;on my way&rdquo;, two-way messages in the contact thread) and alerts to your team. Customers can reply, and replies land in the right contact&apos;s thread.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!plan ? (
            <p className="rounded-md bg-surface-subtle px-4 py-3 text-sm text-ink-3">The SMS add-on isn&apos;t available yet. GoInstall will let you know when it is.</p>
          ) : (
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-surface-subtle p-3">
                <dt className="text-[13px] text-ink-3">Monthly price</dt>
                <dd className="stat text-xl font-bold">{formatPence(plan.monthlyPence)}</dd>
              </div>
              <div className="rounded-lg bg-surface-subtle p-3">
                <dt className="text-[13px] text-ink-3">Texts included each month</dt>
                <dd className="stat text-xl font-bold">{plan.includedTexts.toLocaleString("en-GB")}</dd>
              </div>
              <div className="rounded-lg bg-surface-subtle p-3">
                <dt className="text-[13px] text-ink-3">Each extra text</dt>
                <dd className="stat text-xl font-bold">{formatPence(plan.extraTextPence)}</dd>
              </div>
            </dl>
          )}
          {plan && <p className="text-xs text-muted-foreground">A text is up to 160 characters (70 with emoji); longer messages count as more than one. Extra texts are added to the next monthly invoice.</p>}

          {subscribed && status === "checkout" && <p role="status" className="text-sm text-ink-3">Payment received: confirming with Stripe…</p>}

          {plan && (status === "checkout" || status === "cancelled") && (
            <ActionForm action={startSmsSubscriptionAction}>
              <SubmitButton pendingText="Opening Stripe…">{status === "cancelled" ? "Restart SMS" : `Add SMS for ${formatPence(plan.monthlyPence)} a month`}</SubmitButton>
            </ActionForm>
          )}

          {status === "active" && account && usage && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                Your number: <span className="stat font-semibold">{account.phone_number?.replace(/^\+44(\d{4})(\d{6})$/, "0$1 $2")}</span>
              </p>
              <p className="text-sm">
                This month{account.current_period_start ? ` (since ${formatDate(account.current_period_start, { day: "numeric", month: "long" })})` : ""}: <span className="font-semibold">{usage.used.toLocaleString("en-GB")}</span> of {usage.included.toLocaleString("en-GB")} texts
                {usage.extra > 0 && <span className="text-warning-text"> · {usage.extra} extra, {formatPence(usage.extraPence)} on the next invoice</span>}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-divider" role="img" aria-label={`${usage.used} of ${usage.included} texts used`}>
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, (usage.used / Math.max(1, usage.included)) * 100)}%` }} />
              </div>
            </div>
          )}
          {status === "past_due" && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-900">The last payment failed, so texts are paused. Update your card to carry on.</p>}
          {account?.stripe_customer_id && status !== "checkout" && (
            <ActionForm action={smsBillingPortalAction}>
              <SubmitButton variant="outline" pendingText="Opening…">
                Card, invoices and cancelling
              </SubmitButton>
            </ActionForm>
          )}
          {!smsService() && status === "active" && <p className="text-xs text-warning-text">Texts can&apos;t go out from this environment (Twilio isn&apos;t configured here).</p>}
        </CardContent>
      </Card>

      {(status === "pending_number" || (status === "active" && details.legalName)) && (
        <Card>
          <CardHeader className="flex-col items-start">
            <CardTitle>Business details for your number</CardTitle>
            <p className="text-sm text-ink-3">UK regulations require these before a number is issued. We submit them to Twilio and email you when your number is ready, usually within a few working days.</p>
          </CardHeader>
          <CardContent>
            <ActionForm action={saveSmsBusinessDetailsAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Registered business name" htmlFor="sms-legal">
                <Input id="sms-legal" name="legalName" defaultValue={details.legalName ?? company.name} required />
              </Field>
              <Field label="Company number" htmlFor="sms-number" hint="Companies House, if you're a limited company">
                <Input id="sms-number" name="companyNumber" defaultValue={details.companyNumber ?? company.company_number ?? ""} />
              </Field>
              <Field label="Registered address" htmlFor="sms-address" className="sm:col-span-2">
                <Input id="sms-address" name="address" defaultValue={details.address ?? [company.address_line1, company.address_line2, company.town, company.postcode].filter(Boolean).join(", ")} required />
              </Field>
              <Field label="Contact name" htmlFor="sms-contact">
                <Input id="sms-contact" name="contactName" defaultValue={details.contactName ?? session.fullName} required />
              </Field>
              <Field label="Contact email" htmlFor="sms-email">
                <Input id="sms-email" name="contactEmail" type="email" defaultValue={details.contactEmail ?? session.email} required />
              </Field>
              <Field label="Contact phone" htmlFor="sms-phone">
                <Input id="sms-phone" name="contactPhone" type="tel" defaultValue={details.contactPhone ?? company.phone ?? ""} />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton>{details.submittedAt ? "Update details" : "Send details"}</SubmitButton>
                {details.submittedAt && <p className="mt-2 text-xs text-muted-foreground">Sent {formatDate(new Date(details.submittedAt), { day: "numeric", month: "long" })}.</p>}
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </>
  );
}
