"use server";

import { randomBytes } from "node:crypto";
import { formatPence, parsePence } from "@goinstall/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { emailBalanceInvoice, hashPayToken } from "@/lib/completion";
import { emailConfigured } from "@/lib/email";
import { recordInvoicePayment } from "@/lib/deposits";
import type { ActionResult } from "./crm";

const uuid = z.uuid();

/** Balance card: record the balance paid by bank transfer. */
export async function recordBalanceTransferAction(invoiceId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(invoiceId).success) return { error: "Invoice not found" };
  const amount = parsePence(String(form.get("amount") ?? ""));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "Enter the amount received." };
  return asUser(async (tx, session) => {
    const inv = await tx.selectFrom("invoices").select(["id", "status", "project_id", "kind"]).where("id", "=", invoiceId).executeTakeFirst();
    if (!inv || inv.kind !== "balance") return { error: "Invoice not found" };
    if (inv.status === "paid") return { error: "The balance is already recorded as paid." };
    await recordInvoicePayment(tx, { companyId: session.companyId, invoiceId: inv.id, amountPence: amount, method: "bank_transfer", provider: null, providerRef: null, actorId: session.userId });
    revalidatePath(`/projects/${inv.project_id}`, "layout");
    return { message: `Balance of ${formatPence(amount)} recorded as paid.` };
  });
}

/** Email the balance invoice again with a fresh pay link (the old link stops working). */
export async function resendBalanceInvoiceAction(invoiceId: string): Promise<ActionResult> {
  if (!uuid.safeParse(invoiceId).success) return { error: "Invoice not found" };
  return asUser(async (tx, session) => {
    const inv = await tx.selectFrom("invoices").select(["id", "number", "amount_pence", "status", "project_id", "kind"]).where("id", "=", invoiceId).executeTakeFirst();
    if (!inv || inv.kind !== "balance") return { error: "Invoice not found" };
    if (inv.status === "paid") return { error: "This invoice is already paid." };
    const token = randomBytes(24).toString("base64url");
    await tx.updateTable("invoices").set({ pay_token_hash: hashPayToken(token) }).where("id", "=", inv.id).execute();
    const sent = await emailBalanceInvoice(tx, session.companyId, inv.project_id, { id: inv.id, number: inv.number, amountPence: Number(inv.amount_pence) }, token, { userId: session.userId, name: session.fullName, email: session.email });
    if (!sent.ok) return { error: `Not sent: ${sent.error}` };
    revalidatePath(`/projects/${inv.project_id}`, "layout");
    return { message: emailConfigured() ? "Invoice emailed again with a new pay link." : "Invoice email recorded (sending isn't set up here, so nothing was delivered)." };
  });
}
