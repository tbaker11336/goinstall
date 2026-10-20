import { formatPence } from "@goinstall/core";
import { withService } from "@goinstall/db";
import type { Metadata } from "next";
import { Logo } from "@/components/sidebar";
import { hashPayToken } from "@/lib/completion";
import { db } from "@/lib/db";
import { payments } from "@/lib/payments";
import { formatDate } from "@/lib/utils";
import { PayInvoiceButton } from "./pay-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your invoice",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PublicInvoicePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { token } = await params;
  const { paid } = await searchParams;
  const data = /^[A-Za-z0-9_-]{20,64}$/.test(token)
    ? await withService(db(), (tx) =>
        tx
          .selectFrom("invoices as i")
          .innerJoin("companies as c", "c.id", "i.company_id")
          .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "i.project_id").onRef("p.company_id", "=", "i.company_id"))
          .innerJoin("contacts as ct", "ct.id", "p.contact_id")
          .select([
            "i.number",
            "i.kind",
            "i.amount_pence",
            "i.status",
            "i.issued_at",
            "i.paid_at",
            "c.name as company_name",
            "c.brand_primary_colour",
            "c.phone",
            "c.email",
            "c.bank_account_name",
            "c.bank_sort_code",
            "c.bank_account_number",
            "c.payment_terms",
            "c.stripe_account_id",
            "ct.name as contact_name",
            "p.site_address_line1",
            "p.site_town",
            "p.site_postcode",
          ])
          .where("i.pay_token_hash", "=", hashPayToken(token))
          .where("i.status", "!=", "void")
          .executeTakeFirst(),
      )
    : null;

  const accent = data?.brand_primary_colour && /^#[0-9a-f]{6}$/i.test(data.brand_primary_colour) ? data.brand_primary_colour : null;
  const style = accent ? ({ "--primary": accent, "--primary-hover": accent, "--ring": accent } as React.CSSProperties) : undefined;
  const isPaid = data?.status === "paid";
  const card = Boolean(data?.stripe_account_id && payments());

  return (
    <div style={style} className="min-h-dvh bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-2.5 px-4 py-3.5">
          <Logo size={28} />
          <span className="font-bold">{data?.company_name ?? "GoInstall"}</span>
        </div>
      </div>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pt-6 pb-12">
        {!data ? (
          <section className="rounded-2xl border bg-card px-6 py-10 text-center">
            <h1 className="text-xl font-bold">This link isn&apos;t working</h1>
            <p className="mt-2 text-ink-3">Please ask the installer who sent it for a new link.</p>
          </section>
        ) : (
          <section className="flex flex-col gap-5 rounded-2xl border bg-card p-6">
            <div>
              <p className="text-sm text-ink-3">Invoice {data.number} · {formatDate(data.issued_at, { day: "numeric", month: "long", year: "numeric" })}</p>
              <h1 className="mt-1 text-2xl font-bold">{data.kind === "balance" ? "Balance due" : "Amount due"}</h1>
              <p className="text-ink-3">
                {data.contact_name} · {[data.site_address_line1, data.site_town, data.site_postcode].filter(Boolean).join(", ")}
              </p>
            </div>
            <p className="stat text-4xl font-bold">{formatPence(Number(data.amount_pence))}</p>
            {isPaid || paid ? (
              <p role="status" className="rounded-md bg-success-tint px-4 py-3 font-semibold text-success-text">
                {isPaid ? `Paid${data.paid_at ? ` on ${formatDate(data.paid_at, { day: "numeric", month: "long" })}` : ""}. Thank you.` : "Thank you: your payment is being confirmed."}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {card && <PayInvoiceButton token={token} label={`Pay ${formatPence(Number(data.amount_pence))} by card`} />}
                {data.bank_account_number && (
                  <div className="rounded-lg bg-surface-subtle p-4 text-sm">
                    <p className="font-semibold">{card ? "Or pay by bank transfer" : "Pay by bank transfer"}</p>
                    <p>
                      {data.bank_account_name ?? data.company_name} · sort code {data.bank_sort_code} · account {data.bank_account_number}
                    </p>
                    <p>Reference: {data.number}</p>
                  </div>
                )}
                {!card && !data.bank_account_number && <p className="text-sm text-ink-3">Please contact {data.company_name} to pay.</p>}
                {data.payment_terms && <p className="text-[13px] text-ink-3">{data.payment_terms}</p>}
              </div>
            )}
            <p className="text-[13px] text-ink-3">{[data.company_name, data.phone, data.email].filter(Boolean).join(" · ")}</p>
          </section>
        )}
      </main>
    </div>
  );
}
