"use server";

import { randomUUID } from "node:crypto";
import { formatPence, proposalReference } from "@goinstall/core";
import { sql, withService, type Tx } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { ensureDepositInvoice } from "@/lib/deposits";
import { env } from "@/lib/env";
import { fileStore } from "@/lib/files";
import { payments } from "@/lib/payments";
import { findPublicProposal, type PublicProposal } from "@/lib/proposals";

export interface AcceptResult {
  error?: string;
  ok?: boolean;
}

const acceptSchema = z.object({
  name: z.string().trim().min(2, "Type your full name").max(120),
  agreed: z.literal(true, { error: "Tick to agree to the proposal and terms" }),
  // PNG data URL from the signature pad; optional so the typed name works without a pointer.
  signature: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "The signature couldn't be read")
    .max(400_000, "The signature is too large")
    .nullable(),
});

function withProposal<T>(token: string, fn: (tx: Tx, p: PublicProposal) => Promise<T>): Promise<T | { error: string }> {
  return withService(db(), async (tx) => {
    const p = await findPublicProposal(tx, token);
    if (!p) return { error: "This link isn't working. Please ask your installer for a new one." };
    return fn(tx, p);
  });
}

/** Customer accepts and signs: records name, signature, IP and browser; raises the deposit invoice. */
export async function acceptProposalAction(token: string, input: z.input<typeof acceptSchema>): Promise<AcceptResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
  const ua = h.get("user-agent")?.slice(0, 300) ?? null;
  const result = await withProposal(token, async (tx, p): Promise<AcceptResult> => {
    const row = await tx
      .selectFrom("proposals")
      .select(["status", "valid_until", "deposit_pence", "total_pence"])
      .where("id", "=", p.id)
      .where("company_id", "=", p.companyId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (row.status === "accepted") return { ok: true };
    if (!["sent", "viewed"].includes(row.status)) return { error: "This proposal has been replaced. Please use the latest link from your installer." };
    if (row.valid_until && new Date(`${row.valid_until.toISOString().slice(0, 10)}T23:59:59Z`) < new Date()) return { error: "This proposal has expired. Please ask your installer to refresh it." };

    let signatureFileId: string | null = null;
    if (parsed.data.signature) {
      const bytes = Buffer.from(parsed.data.signature.split(",")[1]!, "base64");
      signatureFileId = randomUUID();
      const path = `${p.companyId}/${p.projectId}/${signatureFileId}.png`;
      await fileStore().put(path, new Uint8Array(bytes), "image/png");
      await tx
        .insertInto("files")
        .values({ id: signatureFileId, company_id: p.companyId, project_id: p.projectId, kind: "signature", path, content_type: "image/png", size_bytes: bytes.length, original_name: "signature.png", source: "customer", uploaded_by: null, created_by: null })
        .execute();
    }
    await tx
      .updateTable("proposals")
      .set({
        status: "accepted",
        accepted_at: sql<Date>`now()`,
        accepted_name: parsed.data.name,
        accepted_ip: z.union([z.ipv4(), z.ipv6()]).safeParse(ip).success ? ip : null,
        accepted_user_agent: ua,
        signature_file_id: signatureFileId,
      })
      .where("id", "=", p.id)
      .where("company_id", "=", p.companyId)
      .execute();
    const deposit = Number(row.deposit_pence);
    if (deposit > 0) await ensureDepositInvoice(tx, { companyId: p.companyId, projectId: p.projectId, proposalId: p.id, depositPence: deposit });
    await tx
      .updateTable("projects")
      .set({ stage: "accepted", value: (Number(row.total_pence) / 100).toFixed(2) })
      .where("id", "=", p.projectId)
      .where("company_id", "=", p.companyId)
      .where("stage", "in", ["enquiry", "survey", "design", "proposal_sent"])
      .execute();
    await tx
      .insertInto("messages")
      .values({ company_id: p.companyId, contact_id: p.contactId, project_id: p.projectId, channel: "system", direction: "internal", body: `${parsed.data.name} accepted proposal ${proposalReference(null, p.number, p.version)}${deposit > 0 ? `. Deposit of ${formatPence(deposit)} due.` : "."}`, created_by: null })
      .execute();
    await tx.insertInto("activity_log").values({ company_id: p.companyId, project_id: p.projectId, contact_id: p.contactId, actor_id: null, event: "proposal_accepted", payload: { name: parsed.data.name } }).execute();
    return { ok: true };
  });
  revalidatePath(`/p/${token}`);
  return result;
}

/** "Pay deposit by card": Stripe Checkout on the installer's own connected account. */
export async function payDepositByCardAction(token: string): Promise<AcceptResult> {
  const provider = payments();
  if (!provider) return { error: "Card payments aren't available. Please pay by bank transfer." };
  const base = env.siteUrl.replace(/\/$/, "");
  const r = await withProposal(token, async (tx, p) => {
    const inv = await tx
      .selectFrom("invoices as i")
      .innerJoin("companies as c", "c.id", "i.company_id")
      .select(["i.id", "i.number", "i.amount_pence", "i.status", "c.name", "c.stripe_account_id"])
      .where("i.proposal_id", "=", p.id)
      .where("i.company_id", "=", p.companyId)
      .where("i.kind", "=", "deposit")
      .where("i.status", "!=", "void")
      .executeTakeFirst();
    if (!inv) return { error: "Accept the proposal first." };
    if (inv.status === "paid") return { error: "Your deposit has already been paid. Thank you." };
    if (!inv.stripe_account_id) return { error: "Card payments aren't available. Please pay by bank transfer." };
    const session = await provider.createCheckout({
      amountPence: Number(inv.amount_pence),
      description: `Deposit for ${inv.name} (${inv.number})`,
      customerEmail: p.contactEmail,
      successUrl: `${base}/p/${token}?paid=1`,
      cancelUrl: `${base}/p/${token}`,
      metadata: { invoice_id: inv.id, company_id: p.companyId },
      connectedAccountId: inv.stripe_account_id,
      idempotencyKey: `deposit-${inv.id}-${Math.floor(Date.now() / 600_000)}`,
    });
    return { url: session.url };
  }).catch(() => ({ error: "Card payment couldn't be started. Please try again or pay by bank transfer." }));
  if ("url" in r && r.url) redirect(r.url);
  return r as AcceptResult;
}
