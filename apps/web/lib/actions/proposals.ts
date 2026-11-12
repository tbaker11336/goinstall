"use server";

import { firstName, formatPence, lineTotal, parsePence, proposalReference, proposalTotals, type DraftLine, type LineDisplay } from "@goinstall/core";
import { syncToXeroLater } from "@/lib/xero";
import { sql, withService, type Tx } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureDepositInvoice, recordInvoicePayment, writeSystemNote, type SystemNote } from "@/lib/deposits";
import { emailConfigured, emailSender, fromAddress } from "@/lib/email";
import { fileStore } from "@/lib/files";
import { notifyTeam } from "@/lib/notify";
import { captureLayout } from "@/lib/proposal-layout";
import { designInputs, hashToken, newLinkNonce, PROPOSAL_LINK_DAYS, proposalToken, proposalUrl, refreshProposalFinance, refreshProposalSurvey } from "@/lib/proposals";
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
          display: l.display ?? "show",
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

const lineFromRow = (r: { section: string; product_id: string | null; description: string; quantity: string | number; unit_price_pence: string | number; vat_rate: string | number; origin: string; display: string }): DraftLine => ({
  section: r.section as DraftLine["section"],
  productId: r.product_id,
  description: r.description,
  quantity: Number(r.quantity),
  unitPricePence: Number(r.unit_price_pence),
  vatRate: Number(r.vat_rate),
  origin: r.origin as DraftLine["origin"],
  display: r.display as LineDisplay,
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
    if (solar) summary.layout = await captureLayout(tx, { projectId, companyId: company.id, solarDesignId: solar.id, segments: solar.segments });
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
        .set({ summary: JSON.stringify(summary), solar_design_id: solar?.id ?? null, ev_design_id: ev?.id ?? null, terms: company.terms_and_conditions, terms_file_id: company.terms_file_id })
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
          // A new version keeps the survey notes written on the last one.
          survey_notes: JSON.stringify(latest?.survey_notes ?? {}),
          summary: JSON.stringify(summary),
          solar_design_id: solar?.id ?? null,
          ev_design_id: ev?.id ?? null,
          deposit_pct: latest ? Number(latest.deposit_pct) : Number(company.default_deposit_pct),
          valid_until: validUntil ? validUntil.toISOString().slice(0, 10) : null,
          terms: company.terms_and_conditions,
          terms_file_id: company.terms_file_id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      proposalId = p.id;
    }
    // Rebuilt lines keep what the customer was shown of them last time.
    const shown = new Map<string, LineDisplay>();
    const source = latest?.id;
    if (source) {
      const prev = await tx.selectFrom("proposal_lines").select(["origin", "product_id", "display"]).where("proposal_id", "=", source).where("origin", "!=", "custom").execute();
      for (const r of prev) shown.set(`${r.origin}:${r.product_id ?? ""}`, r.display as LineDisplay);
    }
    const rebuilt = built.lines.map((l) => ({ ...l, display: shown.get(`${l.origin}:${l.productId ?? ""}`) ?? "show" }));
    const lines = await writeLines(tx, proposalId, [...rebuilt, ...keep]);
    const dep = await tx.selectFrom("proposals").select("deposit_pct").where("id", "=", proposalId).executeTakeFirstOrThrow();
    await writeTotals(tx, proposalId, lines, Number(dep.deposit_pct));
    await refreshProposalFinance(tx, proposalId);
    await refreshProposalSurvey(tx, proposalId);
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
  display: z.enum(["show", "hide_price", "hide"]).default("show"),
});
const draftSchema = z.object({
  title: z.string().trim().min(1, "Give the proposal a title").max(200),
  intro: z.string().trim().max(3000),
  depositPct: z.number().min(0).max(100),
  lines: z.array(lineSchema).min(1, "Add at least one line").max(100),
  /** Notes beside each survey section, and the sections to leave off. */
  surveyNotes: z.record(z.string().max(200), z.object({ note: z.string().trim().max(3000).nullable(), hidden: z.boolean() })).optional(),
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
    lines.push({ section: l.section, productId: l.productId, description: l.description, quantity: l.quantity, unitPricePence: l.unitPrice.trim().startsWith("-") ? -pence : pence, vatRate: l.vatRate, origin: l.origin, display: l.display });
  }
  return asUser(async (tx) => {
    const p = await tx.selectFrom("proposals").select(["id", "status", "project_id"]).where("id", "=", proposalId).executeTakeFirst();
    if (!p) return { error: "Proposal not found" };
    if (p.status !== "draft") return { error: "This version has been sent. Create a new version to make changes." };
    await tx
      .updateTable("proposals")
      .set({ title: parsed.data.title, intro: parsed.data.intro || null, ...(parsed.data.surveyNotes ? { survey_notes: JSON.stringify(parsed.data.surveyNotes) } : {}) })
      .where("id", "=", proposalId)
      .execute();
    await writeLines(tx, proposalId, lines);
    const t = await writeTotals(tx, proposalId, lines, parsed.data.depositPct);
    await refreshProposalFinance(tx, proposalId);
    await refreshProposalSurvey(tx, proposalId);
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
    .leftJoin("files as tf", (j) => j.onRef("tf.id", "=", "pr.terms_file_id").onRef("tf.company_id", "=", "pr.company_id"))
    .select(["tf.path as terms_path", "tf.original_name as terms_name", "pr.id", "pr.status", "pr.number", "pr.version", "pr.total_pence", "pr.link_nonce", "pr.project_id", "pr.valid_until", "pj.stage", "pj.contact_id", "c.name", "c.email", "co.name as company_name", "co.email as company_email", "co.email_sender", "co.document_prefix"])
    .where("pr.id", "=", proposalId)
    .executeTakeFirst();
  if (!p) return { error: "Proposal not found" };
  if (!p.email) return { error: `${p.name} has no email address. Add one on the contact page.` };
  if (Number(p.total_pence) <= 0) return { error: "The proposal total is zero." };
  if (kind === "reminder" && !["sent", "viewed"].includes(p.status)) return { error: "Only a sent proposal can be chased." };

  // Datasheets for the products the customer can see on the proposal (a few, to keep the email small).
  const sheets =
    kind !== "send"
      ? []
      : await tx
          .selectFrom("proposal_lines as l")
          .innerJoin("products as pd", (j) => j.onRef("pd.id", "=", "l.product_id").onRef("pd.company_id", "=", "l.company_id"))
          .innerJoin("files as f", (j) => j.onRef("f.id", "=", "pd.datasheet_file_id").onRef("f.company_id", "=", "pd.company_id"))
          .select(["pd.name", "f.path"])
          .distinct()
          .where("l.proposal_id", "=", p.id)
          .where("l.display", "!=", "hide")
          .limit(6)
          .execute();
  const attachedParts = [p.terms_path ? "Our terms and conditions" : null, sheets.length ? (p.terms_path ? "the datasheets for the products we've quoted" : "The datasheets for the products we've quoted") : null].filter(Boolean);
  const attached = attachedParts.length ? `${attachedParts.join(" and ")} are` : "";
  const nonce = p.link_nonce ?? newLinkNonce();
  const token = proposalToken(p.id, nonce);
  const url = proposalUrl(token);
  const ref = proposalReference(p.document_prefix, p.number);
  const subject = kind === "send" ? `Your proposal from ${p.company_name} (${ref})` : `A reminder about your proposal from ${p.company_name}`;
  const body =
    kind === "send"
      ? `Hi ${firstName(p.name)},\n\nThanks for your time. Your proposal is ready to view online:\n\n${url}\n\nYou can download it as a PDF, and accept and sign it on the same page when you're ready.${attached ? ` ${attached} attached.` : ""}${p.valid_until ? ` It's valid until ${new Date(p.valid_until).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.` : ""}\n\nAny questions, just reply to this email.\n\n${session.fullName}\n${p.company_name}`
      : `Hi ${firstName(p.name)},\n\nJust checking you received your proposal. You can view it, download the PDF and accept it here:\n\n${url}\n\nHappy to answer any questions.\n\n${session.fullName}\n${p.company_name}`;

  if (kind === "send") {
    // The survey as it is now goes out with it (and stays that way).
    await refreshProposalSurvey(tx, p.id);
    // Earlier versions stop being the live one, but an accepted one is never superseded.
    await tx.updateTable("proposals").set({ status: "superseded", token_hash: null, token_expires_at: null }).where("project_id", "=", p.project_id).where("number", "=", p.number).where("id", "!=", p.id).where("status", "in", ["sent", "viewed", "declined"]).execute();
    await tx
      .updateTable("proposals")
      .set({
        status: "sent",
        // The cover and pages as they are now go out with it (and stay that way).
        template: sql`(select proposal_template from public.companies where id = proposals.company_id)`,
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

  // The terms PDF goes with the proposal itself (not reminders): it's also linked on the page.
  const safeName = (n: string) => n.replace(/[^\w .()-]/g, "_");
  const attachments: { filename: string; content: Uint8Array; contentType: string }[] = [];
  if (kind === "send" && p.terms_path) attachments.push({ filename: safeName(p.terms_name ?? "Terms and conditions.pdf"), content: await fileStore().get(p.terms_path), contentType: "application/pdf" });
  for (const d of sheets) attachments.push({ filename: safeName(`${d.name} datasheet.pdf`), content: await fileStore().get(d.path), contentType: "application/pdf" });
  const result = await emailSender().send({ from: fromAddress(p.company_name, p.email_sender), to: p.email, replyTo: session.email || p.company_email || undefined, subject, text: body, html: textToHtml(body), attachments: attachments.length ? attachments : undefined, idempotencyKey: m.id, tags: { kind: `proposal_${kind}` } });
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
  const r: ActionResult & { paid?: { companyId: string; projectId: string; by: string }; note?: SystemNote } = await asUser(async (tx, session) => {
    const p = await tx.selectFrom("proposals").select(["id", "status", "project_id", "company_id", "deposit_pence"]).where("id", "=", proposalId).executeTakeFirst();
    if (!p) return { error: "Proposal not found" };
    if (p.status !== "accepted") return { error: "Record the deposit once the customer has accepted the proposal." };
    const invoice = await ensureDepositInvoice(tx, { companyId: p.company_id, projectId: p.project_id, proposalId: p.id, depositPence: Number(p.deposit_pence) });
    if (invoice.status === "paid") return { error: "The deposit is already recorded as paid." };
    syncToXeroLater(p.company_id, invoice.id);
    const rec = await recordInvoicePayment(tx, { companyId: p.company_id, invoiceId: invoice.id, amountPence: amount, method: "bank_transfer", provider: null, providerRef: null, actorId: session.userId });
    revalidatePath(`/projects/${p.project_id}`, "layout");
    return { message: `Deposit of ${formatPence(amount)} recorded. The project is now at Deposit paid.`, paid: { companyId: p.company_id, projectId: p.project_id, by: session.userId }, note: rec.note };
  });
  // The "paid" line in the thread is a system message, written by the server.
  if (r.note) {
    const note = r.note;
    await withService(db(), (tx) => writeSystemNote(tx, note));
  }
  if ("paid" in r && r.paid) await notifyTeam(r.paid.companyId, "payment_received", { projectId: r.paid.projectId, exclude: r.paid.by, link: `/projects/${r.paid.projectId}/proposal`, data: { detail: `Deposit of ${formatPence(amount)} received by bank transfer` } });
  return { error: r.error, message: r.message };
}
