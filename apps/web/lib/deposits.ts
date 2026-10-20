import "server-only";
import { formatPence } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";

/**
 * Invoice reference from the company prefix: Q-INV-0007. Staff can't update
 * the company row (admin only), so they allocate through next_document_number;
 * the service role (public page, webhook) updates the counter directly.
 */
async function nextInvoiceNumber(tx: Tx, companyId: string) {
  const { rows } = await sql<{ u: string }>`select current_user as u`.execute(tx);
  let n: number;
  if (rows[0]?.u === "authenticated") {
    n = (await sql<{ n: number }>`select public.next_document_number('invoice') as n`.execute(tx)).rows[0]!.n;
  } else {
    const c = await tx
      .updateTable("companies")
      .set((eb) => ({ next_invoice_number: eb("next_invoice_number", "+", 1) }))
      .where("id", "=", companyId)
      .returning("next_invoice_number")
      .executeTakeFirstOrThrow();
    n = c.next_invoice_number - 1;
  }
  const c = await tx.selectFrom("companies").select("document_prefix").where("id", "=", companyId).executeTakeFirstOrThrow();
  return `${(c.document_prefix ?? "Q").replace(/-$/, "")}-INV-${String(n).padStart(4, "0")}`;
}

/**
 * The deposit invoice for an accepted proposal, created once. Runs as the
 * service role (public accept page or webhook) or as staff; always scoped to
 * the company explicitly.
 */
export async function ensureDepositInvoice(tx: Tx, p: { companyId: string; projectId: string; proposalId: string; depositPence: number }) {
  const existing = await tx
    .selectFrom("invoices")
    .select(["id", "number", "amount_pence", "status"])
    .where("company_id", "=", p.companyId)
    .where("proposal_id", "=", p.proposalId)
    .where("kind", "=", "deposit")
    .where("status", "!=", "void")
    .executeTakeFirst();
  if (existing) return existing;
  const number = await nextInvoiceNumber(tx, p.companyId);
  return tx
    .insertInto("invoices")
    .values({ company_id: p.companyId, project_id: p.projectId, proposal_id: p.proposalId, kind: "deposit", number, amount_pence: p.depositPence, status: "open", created_by: null })
    .returning(["id", "number", "amount_pence", "status"])
    .executeTakeFirstOrThrow();
}

/**
 * Mark a deposit paid: record the payment (idempotent on provider ref), close
 * the invoice, move the project to Deposit paid and tell the team.
 * Spec: Deposit paid → draft purchase orders (phase 5) and Xero sync.
 */
export async function recordDepositPayment(
  tx: Tx,
  p: { companyId: string; invoiceId: string; amountPence: number; method: "card" | "bank_transfer"; provider: string | null; providerRef: string | null; actorId: string | null },
): Promise<{ alreadyRecorded: boolean }> {
  if (p.providerRef) {
    const dup = await tx.selectFrom("payments").select("id").where("provider", "=", p.provider).where("provider_ref", "=", p.providerRef).executeTakeFirst();
    if (dup) return { alreadyRecorded: true };
  }
  const invoice = await tx
    .selectFrom("invoices as i")
    .innerJoin("projects as pj", (j) => j.onRef("pj.id", "=", "i.project_id").onRef("pj.company_id", "=", "i.company_id"))
    .select(["i.id", "i.project_id", "i.status", "pj.contact_id", "pj.stage"])
    .where("i.id", "=", p.invoiceId)
    .where("i.company_id", "=", p.companyId)
    .executeTakeFirstOrThrow();
  await tx
    .insertInto("payments")
    .values({ company_id: p.companyId, invoice_id: p.invoiceId, amount_pence: p.amountPence, method: p.method, provider: p.provider, provider_ref: p.providerRef, status: "succeeded", paid_at: sql<Date>`now()`, created_by: p.actorId })
    .execute();
  await tx.updateTable("invoices").set({ status: "paid", paid_at: sql<Date>`now()` }).where("id", "=", p.invoiceId).where("company_id", "=", p.companyId).execute();
  if (["enquiry", "survey", "design", "proposal_sent", "accepted"].includes(invoice.stage)) {
    await tx.updateTable("projects").set({ stage: "deposit_paid" }).where("id", "=", invoice.project_id).where("company_id", "=", p.companyId).execute();
  }
  const how = p.method === "card" ? "by card" : "by bank transfer";
  await tx
    .insertInto("messages")
    .values({ company_id: p.companyId, contact_id: invoice.contact_id, project_id: invoice.project_id, channel: "system", direction: "internal", body: `Deposit of ${formatPence(p.amountPence)} paid ${how}`, created_by: p.actorId })
    .execute();
  await tx
    .insertInto("activity_log")
    .values({ company_id: p.companyId, project_id: invoice.project_id, contact_id: invoice.contact_id, actor_id: p.actorId, event: "deposit_paid", payload: { amount_pence: p.amountPence, method: p.method } })
    .execute();
  return { alreadyRecorded: false };
}
