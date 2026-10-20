import type { DnsRecord } from "@goinstall/integrations";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { checkEmailDomainAction, connectEmailDomainAction, removeEmailDomainAction } from "@/lib/actions/email-domain";
import { asUser } from "@/lib/auth";
import { fromAddress } from "@/lib/email";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Email sending" };

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "default" }> = {
  none: { label: "Not connected", variant: "default" },
  not_started: { label: "Waiting for DNS records", variant: "warning" },
  pending: { label: "Checking DNS", variant: "warning" },
  temporary_failure: { label: "Couldn't check yet", variant: "warning" },
  failed: { label: "Records not found", variant: "warning" },
  verified: { label: "Verified", variant: "success" },
};

export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const c = await asUser(
    (tx, s) =>
      tx
        .selectFrom("companies")
        .select(["name", "email_domain", "email_domain_status", "email_domain_records", "email_domain_checked_at", "email_from_local", "email_sender"])
        .where("id", "=", s.companyId)
        .executeTakeFirstOrThrow(),
    ["admin"],
  );
  const records = (c.email_domain_records ?? []) as unknown as DnsRecord[];
  const status = STATUS[c.email_domain_status] ?? STATUS.none!;
  return (
    <>
      {welcome && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-primary/30 bg-accent-tint px-4 py-3 text-sm text-accent-strong">
          <span>
            <strong>Welcome to GoInstall.</strong> Connect your own domain so customers get surveys and proposals from your address. You can do this later in Settings.
          </span>
          <Link href="/settings/company" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Skip for now
          </Link>
        </div>
      )}
      <Card>
        <CardHeader className="flex-wrap">
          <CardTitle>Send from your own domain</CardTitle>
          <Badge variant={status.variant}>{status.label}</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-ink-3">
            Emails currently go from <strong className="text-foreground">{fromAddress(c.name, c.email_sender)}</strong>. Replies always go to the member of your team who sent the email.
          </p>
          <ActionForm action={connectEmailDomainAction} className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Field label="Your domain" htmlFor="domain" hint="Your website's domain, or a subdomain such as mail.yourcompany.co.uk.">
              <Input id="domain" name="domain" defaultValue={c.email_domain ?? ""} placeholder="yourcompany.co.uk" required aria-describedby="domain-hint" />
            </Field>
            <Field label="Send from" htmlFor="from_local" hint={c.email_domain ? `${c.email_from_local}@${c.email_domain}` : "e.g. hello"}>
              <Input id="from_local" name="from_local" defaultValue={c.email_from_local} required aria-describedby="from_local-hint" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton pendingText="Connecting…">{c.email_domain ? "Save" : "Connect domain"}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>

      {c.email_domain && (
        <Card>
          <CardHeader className="flex-col items-start">
            <CardTitle>DNS records for {c.email_domain}</CardTitle>
            <p className="text-sm text-ink-3">
              Add these at the company that manages your domain (for example GoDaddy, 123 Reg, Cloudflare or your web developer), then check. It can take a few hours for changes to show.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">DNS records to add</caption>
                <thead>
                  <tr className="border-b text-left text-xs text-ink-3">
                    <th className="py-2 pr-3 font-semibold">Type</th>
                    <th className="py-2 pr-3 font-semibold">Name / host</th>
                    <th className="py-2 pr-3 font-semibold">Value</th>
                    <th className="py-2 pr-3 font-semibold">Priority</th>
                    <th className="py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={i} className="border-b align-top" data-testid="dns-record">
                      <td className="py-2.5 pr-3 font-semibold">{r.type}</td>
                      <td className="py-2.5 pr-3">
                        <code className="break-all">{r.name}</code>
                      </td>
                      <td className="max-w-[360px] py-2.5 pr-3">
                        <code className="break-all">{r.value}</code>
                      </td>
                      <td className="py-2.5 pr-3">{r.priority ?? ""}</td>
                      <td className="py-2.5">{r.status === "verified" ? <Badge variant="success">Found</Badge> : <Badge variant="warning">Not found yet</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ActionForm action={checkEmailDomainAction}>
                <SubmitButton variant={c.email_domain_status === "verified" ? "outline" : "default"} pendingText="Checking…">
                  Check now
                </SubmitButton>
              </ActionForm>
              <ActionForm action={removeEmailDomainAction}>
                <SubmitButton variant="ghost" pendingText="Removing…">
                  Remove domain
                </SubmitButton>
              </ActionForm>
              {c.email_domain_checked_at && <span className="text-xs text-muted-foreground">Last checked {formatDateTime(c.email_domain_checked_at)}</span>}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
