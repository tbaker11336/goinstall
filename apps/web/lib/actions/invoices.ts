"use server";

import { formatPence, parsePence, planInvoice, type InvoicePlan } from "@goinstall/core";
import { syncToXeroLater } from "@/lib/xero";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { withService } from "@goinstall/db";
import { db } from "@/lib/db";
import { nextInvoiceNumber, recordInvoicePayment, writeSystemNote, type SystemNote } from "@/lib/deposits";
import { emailConfigured } from "@/lib/email";
import { emailInvoice, kindLabel, newPayLink } from "@/lib/invoices";
import { notifyTeam } from "@/lib/notify";
import type { ActionResult } from "./crm";

const uuid = z.uuid();
const refresh = (projectId: string) => {
  revalidatePath(`/projects/${projectId}`, "layout");
  revalidatePath("/invoices");
};

const newSchema = z.object({
  kind: z.enum(["deposit", "stage", "balance", "extra"]),
  stage_by: z.enum(["percent", "amount"]).optional(),
  percent: z.string().optional(),
  amount: z.string().optional(),
  net: z.string().optional(),
  vat_rate: z.string().optional(),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
  due_date: z.union([z.literal(""), z.iso.date()]).optional(),
  send: z.literal("1").optional(),
});

const money = (v: string | undefined) => {
  const p = parsePence((v ?? "").replace(/[£,\s]/g, ""));
  return p === null || Number.isNaN(p) ? null : p;
};

/**
 * Raise an invoice on an accepted quote: the deposit, a stage payment (a
 * percentage or an amount of the quote), the balance, or extra work outside
 * the quote. Optionally email it straight away with a pay link.
 */
export async function createInvoiceAction(projectId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Project not found" };
  const parsed = newSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  let plan: InvoicePlan;
  if (d.kind === "stage") {
    if (d.stage_by === "amount") {
      const a = money(d.amount);
      if (a === null) return { error: "Enter the amount, like 1500 or 1500.00." };
      plan = { kind: "stage", amountPence: a };
    } else {
      const pc = Number(d.percent);
      if (!d.percent || !Number.isFinite(pc)) return { error: "Enter the percentage of the quote." };
      plan = { kind: "stage", percent: pc };
    }
  } else if (d.kind === "extra") {
    const net = money(d.net);
    const rate = Number(d.vat_rate);
    if (net === null) return { error: "Enter the amount before VAT, like 250 or 250.00." };
    if (d.vat_rate === undefined || d.vat_rate.trim() === "" || !Number.isFinite(rate)) return { error: "Enter the VAT rate (0 if none)." };
    if (!d.description) return { error: "Describe the extra work." };
    plan = { kind: "extra", netPence: net, vatRate: rate };
  } else plan = { kind: d.kind };

  let sendError: string | null = null;
  const r = await asUser(async (tx, session) => {
    const quote = await tx
      .selectFrom("proposals")
      .select(["id", "total_pence", "vat_pence", "deposit_pence"])
      .where("project_id", "=", projectId)
      .where("status", "=", "accepted")
      .orderBy("accepted_at", "desc")
      .executeTakeFirst();
    if (!quote) return { error: "Invoices are raised once the quote has been accepted." };
    const existing = await tx.selectFrom("invoices").select(["kind", "status", "amount_pence"]).where("project_id", "=", projectId).where("proposal_id", "=", quote.id).execute();
    const planned = planInvoice(
      { totalPence: Number(quote.total_pence), vatPence: Number(quote.vat_pence), depositPence: Number(quote.deposit_pence) },
      existing.map((i) => ({ kind: i.kind, status: i.status, amountPence: Number(i.amount_pence) })),
      plan,
    );
    if (!planned.ok) return { error: planned.error };
    const number = await nextInvoiceNumber(tx, session.companyId);
    const inv = await tx
      .insertInto("invoices")
      .values({
        project_id: projectId,
        proposal_id: quote.id,
        kind: d.kind,
        number,
        description: d.description,
        amount_pence: planned.amountPence,
        vat_pence: planned.vatPence,
        status: "open",
        due_date: d.due_date || null,
      })
      .returning(["id", "number"])
      .executeTakeFirstOrThrow();
    syncToXeroLater(session.companyId, inv.id);
    let sent = "";
    if (d.send) {
      const token = await newPayLink(tx, session.companyId, inv.id);
      const e = await emailInvoice(tx, session.companyId, inv.id, token, { userId: session.userId, name: session.fullName, email: session.email });
      if (e.ok) sent = emailConfigured() ? " and emailed to the customer" : " (email recorded; sending isn't set up here)";
      else sendError = e.error;
    }
    refresh(projectId);
    return { message: `Invoice ${inv.number} for ${formatPence(planned.amountPence)} raised${sent}.` };
  });
  if (sendError && r.message) return { message: r.message, error: `Not emailed: ${sendError}` };
  return r;
}

/** Email an invoice (again) with a fresh pay link; the old link stops working. */
export async function emailInvoiceAction(invoiceId: string): Promise<ActionResult> {
  if (!uuid.safeParse(invoiceId).success) return { error: "Invoice not found" };
  return asUser(async (tx, session) => {
    const inv = await tx.selectFrom("invoices").select(["id", "status", "project_id", "sent_at"]).where("id", "=", invoiceId).executeTakeFirst();
    if (!inv) return { error: "Invoice not found" };
    if (inv.status === "void") return { error: "This invoice has been voided." };
    if (inv.status === "paid") return { error: "This invoice is already paid." };
    const token = await newPayLink(tx, session.companyId, inv.id);
    const sent = await emailInvoice(tx, session.companyId, inv.id, token, { userId: session.userId, name: session.fullName, email: session.email });
    if (!sent.ok) return { error: `Not sent: ${sent.error}` };
    refresh(inv.project_id);
    return { message: emailConfigured() ? `Invoice emailed${inv.sent_at ? " again" : ""} with a pay link.` : "Invoice email recorded (sending isn't set up here, so nothing was delivered)." };
  });
}

/** Record an invoice paid by bank transfer (or any payment taken outside GoInstall). */
export async function recordPaymentAction(invoiceId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(invoiceId).success) return { error: "Invoice not found" };
  const amount = money(String(form.get("amount") ?? ""));
  if (amount === null || amount <= 0) return { error: "Enter the amount received." };
  const r: ActionResult & { paid?: { companyId: string; projectId: string; by: string; label: string }; note?: SystemNote } = await asUser(async (tx, session) => {
    const inv = await tx.selectFrom("invoices").select(["id", "status", "project_id", "kind"]).where("id", "=", invoiceId).executeTakeFirst();
    if (!inv) return { error: "Invoice not found" };
    if (inv.status === "paid") return { error: "This invoice is already recorded as paid." };
    if (inv.status === "void") return { error: "This invoice has been voided." };
    syncToXeroLater(session.companyId, inv.id);
    const rec = await recordInvoicePayment(tx, { companyId: session.companyId, invoiceId: inv.id, amountPence: amount, method: "bank_transfer", provider: null, providerRef: null, actorId: session.userId });
    refresh(inv.project_id);
    return { message: `${kindLabel(inv.kind)} of ${formatPence(amount)} recorded as paid.`, paid: { companyId: session.companyId, projectId: inv.project_id, by: session.userId, label: kindLabel(inv.kind) }, note: rec.note };
  });
  // The "paid" line in the customer's thread is a system message, written by the server once the payment is saved.
  if (r.note) {
    const note = r.note;
    await withService(db(), (tx) => writeSystemNote(tx, note));
  }
  if (r.paid) await notifyTeam(r.paid.companyId, "payment_received", { projectId: r.paid.projectId, exclude: r.paid.by, link: `/projects/${r.paid.projectId}/invoices`, data: { detail: `${r.paid.label} of ${formatPence(amount)} received by bank transfer` } });
  return { error: r.error, message: r.message };
}

/** The balance card on the Proposal tab records the balance the same way. */
export async function recordBalanceTransferAction(invoiceId: string, state: ActionResult, form: FormData): Promise<ActionResult> {
  return recordPaymentAction(invoiceId, state, form);
}

/** Cancel an unpaid invoice (it stays on record as void; its pay link stops working). */
export async function voidInvoiceAction(invoiceId: string): Promise<ActionResult> {
  if (!uuid.safeParse(invoiceId).success) return { error: "Invoice not found" };
  return asUser(async (tx, session) => {
    const inv = await tx
      .updateTable("invoices")
      .set({ status: "void", pay_token_hash: null })
      .where("id", "=", invoiceId)
      .where("status", "=", "open")
      .returning(["id", "project_id", "number"])
      .executeTakeFirst();
    if (!inv) return { error: "Only an unpaid invoice can be voided." };
    syncToXeroLater(session.companyId, inv.id);
    await tx.insertInto("activity_log").values({ project_id: inv.project_id, event: "invoice_voided", payload: { number: inv.number }}).execute();
    refresh(inv.project_id);
    return { message: `Invoice ${inv.number} voided.` };
  });
}

/** Email the balance invoice again with a fresh pay link (the old link stops working). */
export async function resendBalanceInvoiceAction(invoiceId: string): Promise<ActionResult> {
  return emailInvoiceAction(invoiceId);
}
