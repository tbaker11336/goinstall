import { describe, expect, it } from "vitest";
import { invoiceSummary, isOverdue, planInvoice, quoteVatShare } from "./invoicing";

// £12,000 including £2,000 VAT, 25% deposit.
const quote = { totalPence: 1_200_000, vatPence: 200_000, depositPence: 300_000 };

describe("invoicing an accepted quote", () => {
  it("adds up what's invoiced, paid and left, leaving void invoices and extras off the quote", () => {
    const s = invoiceSummary(quote, [
      { kind: "deposit", status: "paid", amountPence: 300_000 },
      { kind: "stage", status: "open", amountPence: 400_000 },
      { kind: "stage", status: "void", amountPence: 999_999 },
      { kind: "extra", status: "open", amountPence: 12_000 },
    ]);
    expect(s).toEqual({ quotePence: 1_200_000, invoicedPence: 700_000, remainingPence: 500_000, paidPence: 300_000, outstandingPence: 412_000, extrasPence: 12_000 });
  });

  it("raises the deposit once, stages by percent or amount, and the balance as what's left", () => {
    expect(planInvoice(quote, [], { kind: "deposit" })).toEqual({ ok: true, amountPence: 300_000, vatPence: 50_000 });
    const after = [{ kind: "deposit", status: "paid", amountPence: 300_000 }];
    expect(planInvoice(quote, after, { kind: "deposit" })).toEqual({ ok: false, error: "This quote already has a deposit invoice." });
    expect(planInvoice(quote, after, { kind: "stage", percent: 50 })).toEqual({ ok: true, amountPence: 600_000, vatPence: 100_000 });
    expect(planInvoice(quote, after, { kind: "stage", amountPence: 123_456 })).toMatchObject({ ok: true, amountPence: 123_456, vatPence: quoteVatShare(quote, 123_456) });
    expect(planInvoice(quote, after, { kind: "balance" })).toEqual({ ok: true, amountPence: 900_000, vatPence: 150_000 });
  });

  it("never invoices more of the quote than is left", () => {
    const most = [{ kind: "stage", status: "open", amountPence: 1_100_000 }];
    expect(planInvoice(quote, most, { kind: "stage", percent: 10 })).toEqual({ ok: false, error: "Only £1,000.00 of the quote is left to invoice." });
    expect(planInvoice(quote, [{ kind: "stage", status: "open", amountPence: 1_200_000 }], { kind: "balance" })).toEqual({ ok: false, error: "The whole quote has been invoiced." });
    expect(planInvoice(quote, [], { kind: "stage", percent: 0 })).toMatchObject({ ok: false });
  });

  it("adds VAT at the rate given to extra work, outside the quote", () => {
    expect(planInvoice(quote, [{ kind: "balance", status: "paid", amountPence: 1_200_000 }], { kind: "extra", netPence: 10_000, vatRate: 20 })).toEqual({ ok: true, amountPence: 12_000, vatPence: 2_000 });
    expect(planInvoice(quote, [], { kind: "extra", netPence: 10_000, vatRate: 0 })).toEqual({ ok: true, amountPence: 10_000, vatPence: 0 });
  });

  it("is overdue only when open and past its due date", () => {
    expect(isOverdue({ status: "open", dueDate: "2026-11-01" }, "2026-11-07")).toBe(true);
    expect(isOverdue({ status: "paid", dueDate: "2026-11-01" }, "2026-11-07")).toBe(false);
    expect(isOverdue({ status: "open", dueDate: null }, "2026-11-07")).toBe(false);
  });
});
