/**
 * Invoicing an accepted quote: a deposit, stage payments, the balance, and
 * extra work outside the quote. Amounts are integer pence, VAT inclusive;
 * invoices against the quote carry its VAT in proportion. Nothing can
 * invoice more of the quote than is left.
 */

export const INVOICE_KINDS = ["deposit", "stage", "balance", "extra"] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  deposit: "Deposit",
  stage: "Stage payment",
  balance: "Balance",
  extra: "Extra work",
};

export type InvoiceStatus = "draft" | "open" | "paid" | "void";

export interface InvoiceLike {
  kind: string;
  status: string;
  amountPence: number;
}

export interface QuoteTotals {
  totalPence: number;
  vatPence: number;
  depositPence: number;
}

export interface InvoiceSummary {
  quotePence: number;
  /** Raised against the quote (deposit, stages, balance), not void. */
  invoicedPence: number;
  /** Left of the quote to invoice. */
  remainingPence: number;
  /** Everything paid, extras included. */
  paidPence: number;
  /** Raised and not yet paid, extras included. */
  outstandingPence: number;
  extrasPence: number;
}

const onQuote = (k: string) => k === "deposit" || k === "stage" || k === "balance";

export function invoiceSummary(quote: QuoteTotals, invoices: InvoiceLike[]): InvoiceSummary {
  const live = invoices.filter((i) => i.status !== "void" && i.status !== "draft");
  const invoiced = live.filter((i) => onQuote(i.kind)).reduce((n, i) => n + i.amountPence, 0);
  return {
    quotePence: quote.totalPence,
    invoicedPence: invoiced,
    remainingPence: Math.max(0, quote.totalPence - invoiced),
    paidPence: live.filter((i) => i.status === "paid").reduce((n, i) => n + i.amountPence, 0),
    outstandingPence: live.filter((i) => i.status === "open").reduce((n, i) => n + i.amountPence, 0),
    extrasPence: live.filter((i) => i.kind === "extra").reduce((n, i) => n + i.amountPence, 0),
  };
}

export type InvoicePlan =
  | { kind: "deposit" }
  | { kind: "stage"; percent: number }
  | { kind: "stage"; amountPence: number }
  | { kind: "balance" }
  | { kind: "extra"; netPence: number; vatRate: number };

/** The VAT inside a VAT-inclusive part of the quote, in proportion to the quote's VAT. */
export function quoteVatShare(quote: QuoteTotals, amountPence: number): number {
  if (quote.totalPence <= 0) return 0;
  return Math.round((amountPence * quote.vatPence) / quote.totalPence);
}

/**
 * Work out a new invoice's amount and VAT. Errors are written for the
 * person raising it.
 */
export function planInvoice(
  quote: QuoteTotals,
  invoices: InvoiceLike[],
  plan: InvoicePlan,
): { ok: true; amountPence: number; vatPence: number } | { ok: false; error: string } {
  const s = invoiceSummary(quote, invoices);
  const live = invoices.filter((i) => i.status !== "void");
  const ofQuote = (amount: number) => {
    if (!(amount > 0)) return { ok: false as const, error: "The amount must be more than £0." };
    if (amount > s.remainingPence) return { ok: false as const, error: `Only ${pounds(s.remainingPence)} of the quote is left to invoice.` };
    return { ok: true as const, amountPence: amount, vatPence: quoteVatShare(quote, amount) };
  };
  switch (plan.kind) {
    case "deposit":
      if (live.some((i) => i.kind === "deposit")) return { ok: false, error: "This quote already has a deposit invoice." };
      if (quote.depositPence <= 0) return { ok: false, error: "The quote has no deposit." };
      return ofQuote(quote.depositPence);
    case "stage":
      if ("percent" in plan) {
        if (!(plan.percent > 0 && plan.percent <= 100)) return { ok: false, error: "Enter a percentage between 0 and 100." };
        return ofQuote(Math.round((quote.totalPence * plan.percent) / 100));
      }
      return ofQuote(Math.round(plan.amountPence));
    case "balance":
      if (live.some((i) => i.kind === "balance")) return { ok: false, error: "This quote already has a balance invoice." };
      if (s.remainingPence <= 0) return { ok: false, error: "The whole quote has been invoiced." };
      return { ok: true, amountPence: s.remainingPence, vatPence: quoteVatShare(quote, s.remainingPence) };
    case "extra": {
      if (!(plan.netPence > 0)) return { ok: false, error: "The amount must be more than £0." };
      if (!(plan.vatRate >= 0 && plan.vatRate <= 100)) return { ok: false, error: "Enter the VAT rate as a percentage (0 if none)." };
      const vat = Math.round((plan.netPence * plan.vatRate) / 100);
      return { ok: true, amountPence: Math.round(plan.netPence) + vat, vatPence: vat };
    }
  }
}

/** Open and past its due date (dates as YYYY-MM-DD in UK time). */
export function isOverdue(inv: { status: string; dueDate: string | null }, today: string): boolean {
  return inv.status === "open" && Boolean(inv.dueDate) && inv.dueDate! < today;
}

function pounds(p: number) {
  return `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
