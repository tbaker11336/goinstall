import { formatPence, proposalReference } from "@goinstall/core";
import { withService } from "@goinstall/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { ProposalDocument } from "@/components/proposal-document";
import { Logo } from "@/components/sidebar";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/lib/db";
import { payments } from "@/lib/payments";
import { findPublicProposal, proposalContent, proposalView, recordProposalView } from "@/lib/proposals";
import { formatDateTime } from "@/lib/utils";
import { AcceptForm, PayByCardButton } from "./accept-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your proposal",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Shell({ children, companyName, accent }: { children: React.ReactNode; companyName?: string; accent?: string | null }) {
  const style = accent && /^#[0-9a-f]{6}$/i.test(accent) ? ({ "--primary": accent, "--primary-hover": accent, "--ring": accent } as React.CSSProperties) : undefined;
  return (
    <div style={style} className="min-h-dvh bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl items-center gap-2.5 px-4 py-3.5">
          <Logo size={28} />
          <span className="font-bold">{companyName ?? "GoInstall"}</span>
        </div>
      </div>
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-6 pb-12">{children}</main>
    </div>
  );
}

export default async function PublicProposalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { token } = await params;
  const { paid } = await searchParams;
  const ua = (await headers()).get("user-agent");
  const data = await withService(db(), async (tx) => {
    const p = await findPublicProposal(tx, token);
    if (!p) return null;
    if (p.status !== "accepted") await recordProposalView(tx, p, ua);
    const [content, invoice] = await Promise.all([
      proposalContent(tx, p.id, p.companyId),
      tx.selectFrom("invoices").select(["id", "number", "amount_pence", "status", "paid_at"]).where("proposal_id", "=", p.id).where("company_id", "=", p.companyId).where("kind", "=", "deposit").where("status", "!=", "void").executeTakeFirst(),
    ]);
    const company = await tx.selectFrom("companies").select(["stripe_account_id"]).where("id", "=", p.companyId).executeTakeFirstOrThrow();
    return { p, content: content!, invoice, cardAvailable: Boolean(company.stripe_account_id && payments()) };
  });

  if (!data) {
    return (
      <Shell>
        <section className="rounded-2xl border bg-card px-6 py-10 text-center">
          <h1 className="text-xl font-bold">This link isn&apos;t working</h1>
          <p className="mt-2 text-ink-3">It may have expired or been replaced by a newer version. Please ask the installer who sent it for the latest link.</p>
        </section>
      </Shell>
    );
  }

  const { p, content, invoice, cardAvailable } = data;
  const c = content.proposal;
  const view = proposalView(content);
  const accepted = p.status === "accepted";
  const depositPaid = invoice?.status === "paid";
  const ref = proposalReference(c.document_prefix, c.number);

  return (
    <Shell companyName={c.company_name} accent={c.brand_primary_colour}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Your proposal</h1>
          <p className="text-ink-3">
            Hi {p.contactName.split(/\s+/)[0]}. Here&apos;s what {c.company_name} recommends for {c.site_address_line1 ?? "your home"}.
          </p>
        </div>
        <a href={`/p/${token}/pdf`} className={buttonVariants({ variant: "outline" })}>
          Download PDF
        </a>
      </header>

      {paid && !depositPaid && (
        <p role="status" className="rounded-[10px] bg-info-tint px-4 py-3 text-sm text-info-text">
          Thanks. We&apos;re confirming your payment with the bank; this page will show it once it&apos;s through.
        </p>
      )}

      <ProposalDocument p={view} />

      <section aria-labelledby="next-step" className="flex flex-col gap-4 rounded-[14px] border bg-card p-6 max-md:p-4">
        {!accepted ? (
          <>
            <h2 id="next-step" className="text-lg font-bold">
              Accept and sign
            </h2>
            <p className="text-sm text-ink-3">
              Happy to go ahead? Accept below and {c.company_name} will be in touch to book your installation.
              {Number(c.deposit_pence) > 0 && ` A deposit of ${formatPence(Number(c.deposit_pence))} confirms your booking.`}
            </p>
            <AcceptForm token={token} customerName={p.contactName} hasTerms={Boolean(c.terms)} />
          </>
        ) : depositPaid ? (
          <>
            <h2 id="next-step" className="text-lg font-bold">
              All confirmed
            </h2>
            <p className="text-sm text-ink-3">
              Accepted by {c.accepted_name}
              {c.accepted_at ? ` on ${formatDateTime(c.accepted_at)}` : ""}. Your deposit of {formatPence(Number(invoice!.amount_pence))} has been received. {c.company_name} will be in touch
              to book your installation.
            </p>
          </>
        ) : (
          <>
            <h2 id="next-step" className="text-lg font-bold">
              Pay your deposit
            </h2>
            <p className="text-sm text-ink-3">
              Thanks, {c.accepted_name}: your acceptance is recorded. Pay the deposit of {invoice ? formatPence(Number(invoice.amount_pence)) : "—"} to confirm your booking.
            </p>
            {invoice && cardAvailable && <PayByCardButton token={token} label={`Pay ${formatPence(Number(invoice.amount_pence))} by card`} />}
            {invoice && c.bank_account_number && (
              <div className="rounded-[10px] bg-surface-subtle p-4 text-sm">
                <p className="font-semibold">{cardAvailable ? "Or pay by bank transfer" : "Pay by bank transfer"}</p>
                <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
                  <dt className="text-ink-3">Account name</dt>
                  <dd>{c.bank_account_name ?? c.company_name}</dd>
                  <dt className="text-ink-3">Sort code</dt>
                  <dd>{c.bank_sort_code}</dd>
                  <dt className="text-ink-3">Account number</dt>
                  <dd>{c.bank_account_number}</dd>
                  <dt className="text-ink-3">Reference</dt>
                  <dd>{ref}</dd>
                </dl>
              </div>
            )}
            {invoice && !cardAvailable && !c.bank_account_number && <p className="text-sm">{c.company_name} will send you payment details.</p>}
            {c.payment_terms && <p className="text-xs whitespace-pre-line text-muted-foreground">{c.payment_terms}</p>}
          </>
        )}
      </section>
    </Shell>
  );
}
