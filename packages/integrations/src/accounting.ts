/**
 * Accounting sync (spec: Xero). Deposit and balance invoices, and the
 * payments against them, are pushed to the installer's own accounting
 * package. Only the interface exists until a company connects Xero.
 */
export interface AccountingInvoice {
  reference: string;
  contact: { name: string; email: string | null };
  issuedOn: string;
  dueOn: string | null;
  lines: { description: string; quantity: number; unitAmountPence: number; vatRate: number }[];
}

export interface AccountingProvider {
  readonly name: string;
  /** Create or update the invoice; returns the provider's invoice id. */
  upsertInvoice(invoice: AccountingInvoice, existingId: string | null): Promise<{ id: string }>;
  recordPayment(input: { invoiceId: string; amountPence: number; paidOn: string; reference: string }): Promise<void>;
}
