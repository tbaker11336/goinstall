import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { formatPence } from "@goinstall/core";
import { withService, type Tx } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { db } from "./db";
import { nextInvoiceNumber } from "./deposits";
import { emailSender, fromAddress } from "./email";
import { env } from "./env";
import { syncPaperwork } from "./paperwork";

export const hashPayToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const invoiceUrl = (token: string) => `${env.siteUrl.replace(/\/$/, "")}/i/${token}`;

/**
 * The balance invoice for a project's accepted proposal: total less the
 * deposit, raised once. Returns a fresh pay link when it's new.
 */
export async function ensureBalanceInvoice(tx: Tx, companyId: string, projectId: string): Promise<{ id: string; number: string; amountPence: number; token: string | null } | null> {
  const proposal = await tx
    .selectFrom("proposals")
    .select(["id", "total_pence", "deposit_pence"])
    .where("company_id", "=", companyId)
    .where("project_id", "=", projectId)
    .where("status", "=", "accepted")
    .orderBy("accepted_at", "desc")
    .executeTakeFirst();
  if (!proposal) return null;
  const existing = await tx
    .selectFrom("invoices")
    .select(["id", "number", "amount_pence"])
    .where("company_id", "=", companyId)
    .where("proposal_id", "=", proposal.id)
    .where("kind", "=", "balance")
    .where("status", "!=", "void")
    .executeTakeFirst();
  if (existing) return { id: existing.id, number: existing.number, amountPence: Number(existing.amount_pence), token: null };
  const amount = Number(proposal.total_pence) - Number(proposal.deposit_pence);
  if (amount <= 0) return null;
  const token = randomBytes(24).toString("base64url");
  const number = await nextInvoiceNumber(tx, companyId);
  const inv = await tx
    .insertInto("invoices")
    .values({ company_id: companyId, project_id: projectId, proposal_id: proposal.id, kind: "balance", number, amount_pence: amount, status: "open", pay_token_hash: hashPayToken(token), created_by: null })
    .returning(["id", "number"])
    .executeTakeFirstOrThrow();
  return { id: inv.id, number: inv.number, amountPence: amount, token };
}

/** Email the balance invoice with its pay link and bank details. */
export async function emailBalanceInvoice(tx: Tx, companyId: string, projectId: string, inv: { id: string; number: string; amountPence: number }, token: string, sentBy: { userId: string; name: string; email: string } | null) {
  const p = await tx
    .selectFrom("projects as p")
    .innerJoin("contacts as c", "c.id", "p.contact_id")
    .innerJoin("companies as co", "co.id", "p.company_id")
    .select(["c.id as contact_id", "c.name", "c.email", "co.name as company_name", "co.email as company_email", "co.email_sender", "co.bank_account_name", "co.bank_sort_code", "co.bank_account_number", "co.payment_terms"])
    .where("p.id", "=", projectId)
    .where("p.company_id", "=", companyId)
    .executeTakeFirstOrThrow();
  if (!p.email) return { ok: false as const, error: `${p.name} has no email address` };
  const first = p.name.split(/\s+/)[0] ?? p.name;
  const bank = p.bank_account_number ? `\n\nOr pay by bank transfer to ${p.bank_account_name ?? p.company_name}, sort code ${p.bank_sort_code}, account ${p.bank_account_number}, reference ${inv.number}.` : "";
  const subject = `Invoice ${inv.number} from ${p.company_name}: balance ${formatPence(inv.amountPence)}`;
  const body = `Hi ${first},\n\nYour installation is complete: thank you. The balance of ${formatPence(inv.amountPence)} is now due (invoice ${inv.number}).\n\nView and pay it here: ${invoiceUrl(token)}${bank}${p.payment_terms ? `\n\n${p.payment_terms}` : ""}\n\n${sentBy?.name ?? p.company_name}\n${p.company_name}`;
  const m = await tx
    .insertInto("messages")
    .values({ company_id: companyId, contact_id: p.contact_id, project_id: projectId, channel: "email", direction: "outbound", subject, body, sent_by: sentBy?.userId ?? null, to_address: p.email, delivery_status: "queued", created_by: sentBy?.userId ?? null })
    .returning("id")
    .executeTakeFirstOrThrow();
  const result = await emailSender().send({ from: fromAddress(p.company_name, p.email_sender), to: p.email, replyTo: sentBy?.email || p.company_email || undefined, subject, text: body, html: textToHtml(body), idempotencyKey: m.id, tags: { kind: "balance_invoice" } });
  await tx.updateTable("messages").set(result.ok ? { delivery_status: "sent", provider_message_id: result.providerId } : { delivery_status: "failed", delivery_error: result.error }).where("id", "=", m.id).execute();
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
}

/**
 * After an install is completed in the app (and committed): paperwork items
 * follow the install, the project moves to Complete once no install is
 * open, and the balance invoice is raised and emailed. The handover pack is
 * sent from the console once the certificates are in.
 */
export async function completeInstall(companyId: string, projectId: string): Promise<void> {
  await withService(db(), async (tx) => {
    await syncPaperwork(tx, companyId, projectId);
    const open = await tx
      .selectFrom("bookings")
      .select("id")
      .where("company_id", "=", companyId)
      .where("project_id", "=", projectId)
      .where("type", "=", "install")
      .where("status", "not in", ["completed", "cancelled"])
      .executeTakeFirst();
    if (open) return;
    const project = await tx.selectFrom("projects").select(["stage", "contact_id"]).where("id", "=", projectId).where("company_id", "=", companyId).executeTakeFirstOrThrow();
    if (project.stage !== "complete" && project.stage !== "lost") {
      // The stage trigger writes the activity log.
      await tx.updateTable("projects").set({ stage: "complete" }).where("id", "=", projectId).where("company_id", "=", companyId).execute();
    }
    const inv = await ensureBalanceInvoice(tx, companyId, projectId);
    if (inv?.token) {
      const sent = await emailBalanceInvoice(tx, companyId, projectId, inv, inv.token, null);
      await tx
        .insertInto("messages")
        .values({
          company_id: companyId,
          contact_id: project.contact_id,
          project_id: projectId,
          channel: "system",
          direction: "internal",
          body: `Balance invoice ${inv.number} for ${formatPence(inv.amountPence)} raised${sent.ok ? " and emailed to the customer" : `, but not emailed: ${sent.error}`}`,
          created_by: null,
        })
        .execute();
    }
  });
}
