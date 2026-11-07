import "server-only";
import { randomBytes } from "node:crypto";
import { firstName, formatPence, INVOICE_KIND_LABELS, proposalReference, type InvoiceKind } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { hashPayToken, invoiceUrl } from "./completion";
import { emailSender, fromAddress } from "./email";
import { fileStore } from "./files";
import { renderInvoicePdf, type InvoiceDoc } from "./invoice-pdf";

export const kindLabel = (k: string) => INVOICE_KIND_LABELS[k as InvoiceKind] ?? "Invoice";

/**
 * Everything on an invoice: the company (with logo and bank details), the
 * customer and site, and the amounts. Runs as staff or as the service role,
 * so it always names the company.
 */
export async function invoiceDoc(tx: Tx, companyId: string, invoiceId: string): Promise<(InvoiceDoc & { projectId: string; contactId: string; contactEmail: string | null; emailSender: string | null; companyEmail: string | null }) | null> {
  const r = await tx
    .selectFrom("invoices as i")
    .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "i.project_id").onRef("p.company_id", "=", "i.company_id"))
    .innerJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
    .innerJoin("companies as co", "co.id", "i.company_id")
    .leftJoin("proposals as pr", (j) => j.onRef("pr.id", "=", "i.proposal_id").onRef("pr.company_id", "=", "i.company_id"))
    .select([
      "i.id",
      "i.number",
      "i.kind",
      "i.status",
      "i.description",
      "i.amount_pence",
      "i.vat_pence",
      "i.issued_at",
      "i.due_date",
      "i.paid_at",
      "p.id as project_id",
      "p.site_address_line1",
      "p.site_town",
      "p.site_postcode",
      "c.id as contact_id",
      "c.name as contact_name",
      "c.company_name as contact_company",
      "c.email as contact_email",
      "c.address_line1 as contact_line1",
      "c.town as contact_town",
      "c.postcode as contact_postcode",
      "co.name as company_name",
      "co.logo_path",
      "co.brand_primary_colour",
      "co.address_line1",
      "co.town",
      "co.postcode",
      "co.phone",
      "co.email as company_email",
      "co.email_sender",
      "co.website",
      "co.vat_number",
      "co.company_number",
      "co.bank_account_name",
      "co.bank_sort_code",
      "co.bank_account_number",
      "co.payment_terms",
      "co.document_prefix",
      "pr.number as proposal_number",
      "pr.title as proposal_title",
    ])
    .where("i.id", "=", invoiceId)
    .where("i.company_id", "=", companyId)
    .executeTakeFirst();
  if (!r) return null;
  let logo: InvoiceDoc["logo"] = null;
  const fmt = r.logo_path?.match(/\.(png|jpe?g)$/i)?.[1]?.toLowerCase();
  if (r.logo_path && fmt) logo = await fileStore().get(r.logo_path).then((b) => ({ data: Buffer.from(b), format: fmt === "png" ? ("png" as const) : ("jpg" as const) })).catch(() => null);
  const site = [r.site_address_line1, r.site_town, r.site_postcode].filter(Boolean).join(", ");
  return {
    projectId: r.project_id,
    contactId: r.contact_id,
    contactEmail: r.contact_email,
    emailSender: r.email_sender,
    companyEmail: r.company_email,
    number: r.number,
    kind: r.kind,
    status: r.status,
    title: r.description || (r.proposal_title ? `${kindLabel(r.kind)}: ${r.proposal_title}` : kindLabel(r.kind)),
    amountPence: Number(r.amount_pence),
    vatPence: Number(r.vat_pence),
    issuedAt: r.issued_at,
    dueDate: r.due_date,
    paidAt: r.paid_at,
    company: {
      name: r.company_name,
      brand: r.brand_primary_colour && /^#[0-9a-f]{6}$/i.test(r.brand_primary_colour) ? r.brand_primary_colour : "#0B7A62",
      address: [r.address_line1, r.town, r.postcode].filter(Boolean).join(", ") || null,
      contact: [r.phone, r.company_email, r.website].filter((v): v is string => Boolean(v)),
      vatNumber: r.vat_number,
      companyNumber: r.company_number,
      bank: r.bank_account_number ? { name: r.bank_account_name ?? r.company_name, sortCode: r.bank_sort_code, account: r.bank_account_number } : null,
      paymentTerms: r.payment_terms,
    },
    logo,
    customer: {
      name: r.contact_name,
      company: r.contact_company,
      address: [r.contact_line1, r.contact_town, r.contact_postcode].filter(Boolean).join(", ") || site || null,
    },
    site: site || null,
    quoteRef: r.proposal_number ? proposalReference(r.document_prefix, r.proposal_number) : null,
  };
}

export async function invoicePdf(tx: Tx, companyId: string, invoiceId: string) {
  const doc = await invoiceDoc(tx, companyId, invoiceId);
  if (!doc) return null;
  return { doc, bytes: new Uint8Array(await renderInvoicePdf(doc)) };
}

/** A fresh pay link for an invoice (the previous one stops working). */
export async function newPayLink(tx: Tx, companyId: string, invoiceId: string) {
  const token = randomBytes(24).toString("base64url");
  await tx.updateTable("invoices").set({ pay_token_hash: hashPayToken(token) }).where("id", "=", invoiceId).where("company_id", "=", companyId).execute();
  return token;
}

/**
 * Email an invoice to the customer: the PDF attached, a pay link and the
 * bank details. Recorded in the contact's messages; `sent_at` is set.
 */
export async function emailInvoice(tx: Tx, companyId: string, invoiceId: string, token: string, sentBy: { userId: string; name: string; email: string } | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const pdf = await invoicePdf(tx, companyId, invoiceId);
  if (!pdf) return { ok: false, error: "Invoice not found" };
  const d = pdf.doc;
  if (!d.contactEmail) return { ok: false, error: `${d.customer.name} has no email address` };
  const label = kindLabel(d.kind).toLowerCase();
  const due = d.dueDate ? ` It's due by ${new Date(d.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.` : "";
  const bank = d.company.bank ? `\n\nOr pay by bank transfer to ${d.company.bank.name}, sort code ${d.company.bank.sortCode}, account ${d.company.bank.account}, reference ${d.number}.` : "";
  const lead = d.kind === "balance" ? "Your installation is complete: thank you. " : "";
  const subject = `Invoice ${d.number} from ${d.company.name}: ${label} ${formatPence(d.amountPence)}`;
  const body = `Hi ${firstName(d.customer.name)},\n\n${lead}Please find attached invoice ${d.number} for ${formatPence(d.amountPence)} (${label}${d.title && d.title !== kindLabel(d.kind) ? `: ${d.title}` : ""}).${due}\n\nView and pay it here: ${invoiceUrl(token)}${bank}${d.company.paymentTerms ? `\n\n${d.company.paymentTerms}` : ""}\n\n${sentBy?.name ?? d.company.name}\n${d.company.name}`;
  const m = await tx
    .insertInto("messages")
    .values({ company_id: companyId, contact_id: d.contactId, project_id: d.projectId, channel: "email", direction: "outbound", subject, body, sent_by: sentBy?.userId ?? null, to_address: d.contactEmail, delivery_status: "queued", created_by: sentBy?.userId ?? null })
    .returning("id")
    .executeTakeFirstOrThrow();
  const result = await emailSender().send({
    from: fromAddress(d.company.name, d.emailSender),
    to: d.contactEmail,
    replyTo: sentBy?.email || d.companyEmail || undefined,
    subject,
    text: body,
    html: textToHtml(body),
    idempotencyKey: m.id,
    tags: { kind: `${d.kind}_invoice` },
    attachments: [{ filename: `${d.number}.pdf`, content: pdf.bytes, contentType: "application/pdf" }],
  });
  await tx.updateTable("messages").set(result.ok ? { delivery_status: "sent", provider_message_id: result.providerId } : { delivery_status: "failed", delivery_error: result.error }).where("id", "=", m.id).execute();
  if (result.ok) await tx.updateTable("invoices").set({ sent_at: sql<Date>`now()` }).where("id", "=", invoiceId).where("company_id", "=", companyId).execute();
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
