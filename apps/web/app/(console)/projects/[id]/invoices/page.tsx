import { formatPence, INVOICE_KIND_LABELS, invoiceSummary, isOverdue, proposalReference, ukDate, type InvoiceKind } from "@goinstall/core";
import { FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { InvoiceActions, NewInvoiceForm } from "@/components/invoice-client";
import { InvoiceStatus } from "@/components/invoice-status";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { asUser } from "@/lib/auth";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Invoices" };

export default async function ProjectInvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await asUser(async (tx) => {
    const project = await tx
      .selectFrom("projects as p")
      .innerJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
      .innerJoin("companies as co", "co.id", "p.company_id")
      .select(["p.id", "c.email", "co.document_prefix"])
      .where("p.id", "=", id)
      .executeTakeFirst();
    if (!project) return null;
    const [quote, invoices] = await Promise.all([
      tx
        .selectFrom("proposals")
        .select(["id", "number", "version", "title", "total_pence", "vat_pence", "deposit_pence", "accepted_at"])
        .where("project_id", "=", id)
        .where("status", "=", "accepted")
        .orderBy("accepted_at", "desc")
        .executeTakeFirst(),
      tx.selectFrom("invoices").select(["id", "number", "kind", "status", "description", "amount_pence", "vat_pence", "issued_at", "due_date", "paid_at", "sent_at", "proposal_id"]).where("project_id", "=", id).orderBy("issued_at").execute(),
    ]);
    return { project, quote, invoices };
  });
  if (!data) notFound();
  const { project, quote, invoices } = data;
  const today = ukDate(new Date());
  const rows = invoices.map((i) => ({ ...i, amountPence: Number(i.amount_pence), due: i.due_date ? ukDate(i.due_date) : null }));
  const ofQuote = rows.filter((i) => quote && i.proposal_id === quote.id);
  const totals = quote ? { totalPence: Number(quote.total_pence), vatPence: Number(quote.vat_pence), depositPence: Number(quote.deposit_pence) } : null;
  const summary = totals ? invoiceSummary(totals, ofQuote.map((i) => ({ kind: i.kind, status: i.status, amountPence: i.amountPence }))) : null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        {summary && quote && (
          <section aria-label="Invoicing summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Quote", formatPence(summary.quotePence), `${proposalReference(project.document_prefix, quote.number, quote.version)} · accepted`],
              ["Invoiced", formatPence(summary.invoicedPence), summary.extrasPence ? `+ ${formatPence(summary.extrasPence)} extra work` : "of the quote"],
              ["Paid", formatPence(summary.paidPence), summary.outstandingPence ? `${formatPence(summary.outstandingPence)} unpaid` : "nothing unpaid"],
              ["Left to invoice", formatPence(summary.remainingPence), summary.remainingPence ? "of the quote" : "fully invoiced"],
            ].map(([label, value, sub]) => (
              <div key={label} className="flex flex-col gap-1 rounded-[12px] border bg-card p-4">
                <span className="text-[13px] text-ink-3">{label}</span>
                <span className="text-xl font-bold" data-testid={`summary-${label!.toLowerCase().replace(/ /g, "-")}`}>
                  {value}
                </span>
                <span className="text-xs text-ink-3">{sub}</span>
              </div>
            ))}
          </section>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <ul className="divide-y" aria-label="Project invoices">
                {rows.map((i) => {
                  const overdue = isOverdue({ status: i.status, dueDate: i.due }, today);
                  return (
                    <li key={i.id} className={cn("flex flex-wrap items-start gap-4 py-4", i.status === "void" && "opacity-60")} data-testid="invoice-row">
                      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-surface-subtle">
                        <FileText className="size-4" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="flex flex-wrap items-center gap-2 font-semibold">
                          {i.number} · {INVOICE_KIND_LABELS[i.kind as InvoiceKind] ?? "Invoice"}
                          <InvoiceStatus status={i.status} overdue={overdue} />
                        </p>
                        {i.description && <p className="text-sm">{i.description}</p>}
                        <p className="text-[13px] text-ink-3">
                          Issued {formatDate(i.issued_at, { day: "numeric", month: "short", year: "numeric" })}
                          {i.due ? ` · due ${formatDate(i.due, { day: "numeric", month: "short" })}` : ""}
                          {i.paid_at ? ` · paid ${formatDate(i.paid_at, { day: "numeric", month: "short" })}` : ""}
                          {i.sent_at ? ` · emailed ${formatDate(i.sent_at, { day: "numeric", month: "short" })}` : i.status === "open" ? " · not emailed yet" : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap items-start gap-2">
                          <a href={`/api/invoices/${i.id}/pdf`} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`PDF of ${i.number}`}>
                            PDF
                          </a>
                          <InvoiceActions invoice={{ id: i.id, number: i.number, status: i.status, amountPence: i.amountPence, sent: Boolean(i.sent_at) }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">{formatPence(i.amountPence)}</p>
                        <p className="text-xs text-ink-3">incl. VAT {formatPence(Number(i.vat_pence))}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>New invoice</CardTitle>
          <p className="text-sm text-ink-3">Against the accepted quote, or for extra work outside it.</p>
        </CardHeader>
        <CardContent>
          {totals && quote ? (
            <NewInvoiceForm projectId={id} quote={totals} invoices={ofQuote.map((i) => ({ kind: i.kind, status: i.status, amountPence: i.amountPence }))} canEmail={Boolean(project.email)} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Invoices are raised once the customer accepts the quote.{" "}
              <Link href={`/projects/${id}/proposal`} className="font-semibold text-primary underline">
                Go to the proposal
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
