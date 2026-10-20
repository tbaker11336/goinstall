"use server";

import { firstName, formatPence, lineTotal, parsePence, proposalReference, proposalTotals, type DraftLine } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser, type Session } from "@/lib/auth";
import { ensureDepositInvoice, recordDepositPayment } from "@/lib/deposits";
import { emailConfigured, emailSender, fromAddress } from "@/lib/email";
import { designInputs, hashToken, newLinkNonce, PROPOSAL_LINK_DAYS, proposalToken, proposalUrl } from "@/lib/proposals";
import type { ActionResult } from "./crm";

const uuid = z.uuid();

async function writeLines(tx: Tx, proposalId: string, lines: DraftLine[]) {
  await tx.deleteFrom("proposal_lines").where("proposal_id", "=", proposalId).execute();
  if (lines.length) {
    await tx
      .insertInto("proposal_lines")
      .values(
        lines.map((l, i) => ({
          proposal_id: proposalId,
          section: l.section,
          position: i,
          product_id: l.productId,
          description: l.description,
          quantity: l.quantity,
          unit_price_pence: l.unitPricePence,
          vat_rate: l.vatRate,
          line_total_pence: lineTotal(l),
          origin: l.origin,
        })),
      )
      .execute();
  }
  return lines;
}

async function writeTotals(tx: Tx, proposalId: string, lines: DraftLine[], depositPct: number) {
  const t = proposalTotals(lines, depositPct);
  await tx
    .updateTable("proposals")
    .set({ subtotal_pence: t.subtotalPence, vat_pence: t.vatPence, total_pence: t.totalPence, deposit_pct: depositPct, deposit_pence: t.depositPence })
    .where("id", "=", proposalId)
    .execute();
  return t;
}

const lineFromRow = (r: { section: string; product_id: string | null; description: string; quantity: string | number; unit_price_pence: string | number; vat_rate: string | number; origin: string }): DraftLine => ({
  section: r.section as DraftLine["section"],
  productId: r.product_id,
  description: r.description,
  quantity: Number(r.quantity),
  unitPricePence: Number(r.unit_price_pence),
  vatRate: Number(r.vat_rate),
  origin: r.origin as DraftLine["origin"],
});

/**
 * "Create proposal from design": builds (or rebuilds) the draft from the
 * active designs. Custom lines staff added are kept. Editing a sent
 * proposal starts a new draft version.
 */
export async function createProposalAction(projectId: string): Promise<{ error?: string; proposalId?: string; notes?: string[] }> {
  if (!uuid.safeParse(projectId).success) return { error: "Project not found" };
  const out = await asUser(async (tx) => {
    const project = await tx.selectFrom("projects as p").innerJoin("contacts as c", "c.id", "p.contact_id").select(["p.id", "p.site_address_line1", "c.name"]).where("p.id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    const { solar, ev, company, built, summary } = await designInputs(tx, projectId);
    if (!built.lines.length) return { error: "Design the system first: the proposal is built from the active solar and EV designs." };
    if (company.default_deposit_pct === null) return { error: "Set the default deposit % in Settings › Invoices & quotes first." };
    const latest = await tx.selectFrom("proposals").selectAll().where("project_id", "=", projectId).orderBy("number", "desc").orderBy("version", "desc").limit(1).executeTakeFirst();

    let proposalId: string;
    let keep: DraftLine[] = [];
    if (latest?.status === "draft") {
      proposalId = latest.id;
      keep = (await tx.selectFrom("proposal_lines").selectAll().where("proposal_id", "=", proposalId).where("origin", "=", "custom").execute()).map(lineFromRow);
      await tx
        .updateTable("proposals")
        .set({ summary: JSON.stringify(summary), solar_design_id: solar?.id ?? null, ev_design_id: ev?.id ?? null })
        .where("id", "=", proposalId)
        .execute();
    } else {
      if (latest) keep = (await tx.selectFrom("proposal_lines").selectAll().where("proposal_id", "=", latest.id).where("origin", "=", "custom").execute()).map(lineFromRow);
      const number = latest?.number ?? (await sql<{ n: number }>`select public.next_document_number('proposal') as n`.execute(tx)).rows[0]!.n;
      const validUntil = company.proposal_valid_days ? new Date(Date.now() + company.proposal_valid_days * 86_400_000) : null;
      const p = await tx
        .insertInto("proposals")
        .values({
          project_id: projectId,
          number,
          version: (latest?.version ?? 0) + 1,
          title: latest?.title || `${summary.panelCount ? "Solar" : ""}${solar?.battery_count ? ", battery" : ""}${ev?.charger_product_id ? `${summary.panelCount ? " and " : ""}EV charging` : ""} for ${project.site_address_line1 ?? "your home"}`.replace(/^,\s*/, ""),
          intro: latest?.intro ?? null,
          summary: JSON.stringify(summary),
          solar_design_id: solar?.id ?? null,
          ev_design_id: ev?.id ?? null,
          deposit_pct: latest ? Number(latest.deposit_pct) : Number(company.default_deposit_pct),
          valid_until: validUntil ? validUntil.toISOString().slice(0, 10) : null,
          terms: company.terms_and_conditions,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      proposalId = p.id;
    }
    const lines = await writeLines(tx, proposalId, [...built.lines, ...keep]);
    const dep = await tx.selectFrom("proposals").select("deposit_pct").where("id", "=", proposalId).executeTakeFirstOrThrow();
    await writeTotals(tx, proposalId, lines, Number(dep.deposit_pct));
    return { proposalId, notes: built.notes };
  });
  revalidatePath(`/projects/${projectId}`, "layout");
  return out;
}

const lineSchema = z.object({
  section: z.enum(["solar", "battery", "ev", "installation"]),
  productId: z.uuid().nullable(),
  description: z.string().trim().min(1, "Every line needs a description").max(300),
  quantity: z.number().positive("Quantities must be above zero").max(10000),
  unitPrice: z.string(),
  vatRate: z.number().min(0).max(100),
  origin: z.enum(["design", "custom", "discount"]),
});
const draftSchema = z.object({
  title: z.string().trim().min(1, "Give the proposal a title").max(200),
  intro: z.string().trim().max(3000),
  depositPct: z.number().min(0).max(100),
  lines: z.array(lineSchema).min(1, "Add at least one line").max(100),
});
export type DraftInput = z.infer<typeof draftSchema>;

/** Save the draft's title, intro, deposit and lines (staff edits). */
export async function saveProposalDraftAction(proposalId: string, input: DraftInput): Promise<ActionResult> {
  if (!uuid.safeParse(proposalId).success) return { error: "Proposal not found" };
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const lines: DraftLine[] = [];
  for (const l of parsed.data.lines) {
    const pence = parsePence(l.unitPrice.replace(/^-/, ""));
    if (pence === null || Number.isNaN(pence)) return { error: `"${l.description}": enter a price like 165 or 165.00` };
    lines.push({ section: l.section, productId: l.productId, description: l.description, quantity: l.quantity, unitPricePence: l.unitPrice.trim().startsWith("-") ? -pence : pence, vatRate: l.vatRate, origin: l.origin });
  }
  return asUser(async (tx) => {
    const p = await tx.selectFrom("proposals").select(["id", "status", "project_id"]).where("id", "=", proposalId).executeTakeFirst();
    if (!p) return { error: "Proposal not found" };
    if (p.status !== "draft") return { error: "This version has been sent. Create a new version to make changes." };
    await tx.updateTable("proposals").set({ title: parsed.data.title, intro: parsed.data.intro || null }).where("id", "=", proposalId).execute();
    await writeLines(tx, proposalId, lines);
    const t = await writeTotals(tx, proposalId, lines, parsed.data.depositPct);
    revalidatePath(`/projects/${p.project_id}/proposal`);
    return { message: `Saved. Total ${formatPence(t.totalPence)}, deposit ${formatPence(t.depositPence)}.` };
  });
}

async function emailProposal(tx: Tx, session: Session, proposalId: string, kind: "send" | "reminder"): Promise<ActionResult & { projectId?: string }> {
  const p = await tx
    .selectFrom("proposals as pr")
    .innerJoin("projects as pj", "pj.id", "pr.project_id")
    .innerJoin("contacts as c", "c.id", "pj.contact_id")
    .innerJoin("companies as co", "co.id", "pr.company_id")
    .select(["pr.id", "pr.status", "pr.number", "pr.version", "pr.total_pence", "pr.link_nonce", "pr.project_id", "pr.valid_until", "pj.stage", "pj.contact_id", "c.name", "c.email", "co.name as company_name", "co.email as company_email", "co.email_sender", "co.document_prefix"])
    .where("pr.id", "=", proposalId)
    .executeTakeFirst();
  if (!p) return { error: "Proposal not found" };
  if (!p.email) return { error: `${p.name} has no email address. Add one on the contact page.` };
  if (Number(p.total_pence) <= 0) return { error: "The proposal total is zero." };
  if (kind === "reminder" && !["sent", "viewed"].includes(p.status)) return { error: "Only a sent proposal can be chased." };

  const nonce = p.link_nonce ?? newLinkNonce();
  const token = proposalToken(p.id, nonce);
  const url = proposalUrl(token);
  const ref = proposalReference(p.document_prefix, p.number);
  const subject = kind === "send" ? `Your proposal from ${p.company_name} (${ref})` : `A reminder about your proposal from ${p.company_name}`;
  const body =
    kind === "send"
      ? `Hi ${firstName(p.name)},\n\nThanks for your time. Your proposal is ready to view online:\n\n${url}\n\nYou can download it as a PDF, and accept and sign it on the same page when you're ready.${p.valid_until ? ` It's valid until ${new Date(p.valid_until).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.` : ""}\n\nAny questions, just reply to this email.\n\n${session.fullName}\n${p.company_name}`
      : `Hi ${firstName(p.name)},\n\nJust checking you received your proposal. You can view it, download the PDF and accept it here:\n\n${url}\n\nHappy to answer any questions.\n\n${session.fullName}\n${p.company_name}`;

  if (kind === "send") {
    // Earlier versions stop being the live one, but an accepted one is never superseded.
    await tx.updateTable("proposals").set({ status: "superseded", token_hash: null, token_expires_at: null }).where("project_id", "=", p.project_id).where("number", "=", p.number).where("id", "!=", p.id).where("status", "in", ["sent", "viewed", "declined"]).execute();
    await tx
      .updateTable("proposals")
      .set({
        status: "sent",
        link_nonce: nonce,
        token_hash: hashToken(token),
        token_expires_at: new Date(Date.now() + PROPOSAL_LINK_DAYS * 86_400_000),
        sent_at: sql<Date>`now()`,
        sent_channels: ["email"],
      })
      .where("id", "=", p.id)
      .execute();
    if (["enquiry", "survey", "design"].includes(p.stage)) await tx.updateTable("projects").set({ stage: "proposal_sent" }).where("id", "=", p.project_id).execute();
  } else {
    await tx.updateTable("proposals").set({ last_reminder_at: sql<Date>`now()` }).where("id", "=", p.id).execute();
  }
  const m = await tx
    .insertInto("messages")
    .values({ contact_id: p.contact_id, project_id: p.project_id, channel: "email", direction: "outbound", subject, body, sent_by: session.userId, to_address: p.email, delivery_status: "queued" })
    .returning("id")
    .executeTakeFirstOrThrow();
  await tx.insertInto("activity_log").values({ project_id: p.project_id, contact_id: p.contact_id, event: kind === "send" ? "proposal_sent" : "proposal_reminder", payload: { reference: proposalReference(p.document_prefix, p.number, p.version) } }).execute();

  const result = await emailSender().send({ from: fromAddress(p.company_name, p.email_sender), to: p.email, replyTo: session.email || p.company_email || undefined, subject, text: body, html: textToHtml(body), idempotencyKey: m.id, tags: { kind: `proposal_${kind}` } });
  await tx
    .updateTable("messages")
    .set(result.ok ? { delivery_status: "sent", provider_message_id: result.providerId } : { delivery_status: "failed", delivery_error: result.error })
    .where("id", "=", m.id)
    .execute();
  if (!result.ok) return { error: `Email not sent: ${result.error}`, projectId: p.project_id };
  const live = emailConfigured() ? `Emailed to ${p.email}.` : "Email recorded (sending isn't set up here, so nothing was delivered).";
  return { message: kind === "send" ? `Proposal sent. ${live}` : `Reminder sent. ${live}`, projectId: p.project_id };
}

export async function sendProposalAction(proposalId: string): Promise<ActionResult> {
  if (!uuid.safeParse(proposalId).success) return { error: "Proposal not found" };
  const r = await asUser(async (tx, session) => {
    const p = await tx.selectFrom("proposals").select(["status"]).where("id", "=", proposalId).executeTakeFirst();
    if (!p) return { error: "Proposal not found" };
    if (p.status !== "draft") return { error: "This version has already been sent." };
    return emailProposal(tx, session, proposalId, "send");
  });
  if (r.projectId) revalidatePath(`/projects/${r.projectId}`, "layout");
  return { error: r.error, message: r.message };
}

export async function sendProposalReminderAction(proposalId: string): Promise<ActionResult> {
  if (!uuid.safeParse(proposalId).success) return { error: "Proposal not found" };
  const r = await asUser((tx, session) => emailProposal(tx, session, proposalId, "reminder"));
  if (r.projectId) revalidatePath(`/projects/${r.projectId}`, "layout");
  return { error: r.error, message: r.message };
}

/** "Copy customer link": the same link the customer was sent (derived, not stored). */
export async function proposalLinkAction(proposalId: string): Promise<{ url?: string; error?: string }> {
  if (!uuid.safeParse(proposalId).success) return { error: "Proposal not found" };
  return asUser(async (tx) => {
    const p = await tx.selectFrom("proposals").select(["id", "link_nonce", "token_hash", "status"]).where("id", "=", proposalId).executeTakeFirst();
    if (!p?.link_nonce || !p.token_hash) return { error: "Send the proposal first; the link is created when it's sent." };
    return { url: proposalUrl(proposalToken(p.id, p.link_nonce)) };
  });
}

/** Deposit card: record a deposit paid by bank transfer. */
export async function recordBankTransferAction(proposalId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(proposalId).success) return { error: "Proposal not found" };
  const amount = parsePence(String(form.get("amount") ?? ""));
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "Enter the amount received." };
  return asUser(async (tx, session) => {
    const p = await tx.selectFrom("proposals").select(["id", "status", "project_id", "company_id", "deposit_pence"]).where("id", "=", proposalId).executeTakeFirst();
    if (!p) return { error: "Proposal not found" };
    if (p.status !== "accepted") return { error: "Record the deposit once the customer has accepted the proposal." };
    const invoice = await ensureDepositInvoice(tx, { companyId: p.company_id, projectId: p.project_id, proposalId: p.id, depositPence: Number(p.deposit_pence) });
    if (invoice.status === "paid") return { error: "The deposit is already recorded as paid." };
    await recordDepositPayment(tx, { companyId: p.company_id, invoiceId: invoice.id, amountPence: amount, method: "bank_transfer", provider: null, providerRef: null, actorId: session.userId });
    revalidatePath(`/projects/${p.project_id}`, "layout");
    return { message: `Deposit of ${formatPence(amount)} recorded. The project is now at Deposit paid.` };
  });
}
