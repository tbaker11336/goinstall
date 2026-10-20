"use server";

import { sql } from "@goinstall/db";
import type { SendingDomain } from "@goinstall/integrations";
import { pgErrorCode } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { emailDomains } from "@/lib/email";
import type { ActionResult } from "./crm";

const domainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""))
    .refine((v) => /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v), "Enter a domain like brightsidesolar.co.uk"),
  from_local: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{0,62}$/, "Enter the part before the @, e.g. hello"),
});

function stored(d: SendingDomain, local: string) {
  return {
    email_domain_status: d.status,
    email_domain_records: JSON.stringify(d.records),
    email_domain_checked_at: sql<Date>`now()`,
    email_sender: d.status === "verified" ? `${local}@${d.name}` : null,
  };
}

/** Register the company's domain with the email provider and show the DNS records to add. */
export async function connectEmailDomainAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = domainSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const provider = emailDomains();
  if (!provider) return { error: "Email isn't set up on this GoInstall server yet." };
  const { domain, from_local } = parsed.data;
  return asUser(async (tx, session) => {
    const c = await tx.selectFrom("companies").select(["email_domain", "email_domain_provider_id"]).where("id", "=", session.companyId).executeTakeFirstOrThrow();
    if (c.email_domain === domain && c.email_domain_provider_id) {
      await tx.updateTable("companies").set({ email_from_local: from_local, email_sender: sql`case when email_domain_status = 'verified' then ${`${from_local}@${domain}`} else null end` }).where("id", "=", session.companyId).execute();
      revalidatePath("/settings/email");
      return { message: "Sending address saved." };
    }
    // Other companies are hidden by RLS: a domain already in use shows up as a unique violation below.
    let d: SendingDomain;
    try {
      d = await provider.create(domain);
    } catch (e) {
      return { error: `Couldn't register the domain: ${e instanceof Error ? e.message : "unknown error"}` };
    }
    if (c.email_domain_provider_id) await provider.remove(c.email_domain_provider_id).catch(() => undefined);
    try {
      await tx
        .updateTable("companies")
        .set({ email_domain: domain, email_domain_provider_id: d.id, email_from_local: from_local, ...stored(d, from_local) })
        .where("id", "=", session.companyId)
        .execute();
    } catch (e) {
      if (pgErrorCode(e) === "23505") {
        await provider.remove(d.id).catch(() => undefined);
        return { error: "That domain is already connected to another account." };
      }
      throw e;
    }
    revalidatePath("/settings/email");
    return { message: "Domain added. Now add the DNS records below, then check." };
  }, ["admin"]);
}

/** "Check now": ask the provider to look up the DNS records and store the result. */
export async function checkEmailDomainAction(_?: ActionResult, __?: FormData): Promise<ActionResult> {
  const provider = emailDomains();
  if (!provider) return { error: "Email isn't set up on this GoInstall server yet." };
  return asUser(async (tx, session) => {
    const c = await tx.selectFrom("companies").select(["email_domain_provider_id", "email_from_local"]).where("id", "=", session.companyId).executeTakeFirstOrThrow();
    if (!c.email_domain_provider_id) return { error: "Add a domain first." };
    try {
      await provider.verify(c.email_domain_provider_id);
      const d = await provider.get(c.email_domain_provider_id);
      await tx.updateTable("companies").set(stored(d, c.email_from_local)).where("id", "=", session.companyId).execute();
      revalidatePath("/settings/email");
      revalidatePath("/dashboard");
      if (d.status === "verified") return { message: `Verified. Emails now go from ${c.email_from_local}@${d.name}.` };
      return { message: "Not verified yet. DNS changes can take up to a few hours to show; check again later." };
    } catch (e) {
      return { error: `Couldn't check the domain: ${e instanceof Error ? e.message : "unknown error"}` };
    }
  }, ["admin"]);
}

/** Stop using the domain: email goes from the GoInstall address again. */
export async function removeEmailDomainAction(_?: ActionResult, __?: FormData): Promise<ActionResult> {
  const provider = emailDomains();
  return asUser(async (tx, session) => {
    const c = await tx.selectFrom("companies").select(["email_domain_provider_id"]).where("id", "=", session.companyId).executeTakeFirstOrThrow();
    if (c.email_domain_provider_id && provider) await provider.remove(c.email_domain_provider_id).catch(() => undefined);
    await tx
      .updateTable("companies")
      .set({ email_domain: null, email_domain_provider_id: null, email_domain_status: "none", email_domain_records: JSON.stringify([]), email_sender: null, email_domain_checked_at: null })
      .where("id", "=", session.companyId)
      .execute();
    revalidatePath("/settings/email");
    return { message: "Domain removed. Emails go from the GoInstall address again." };
  }, ["admin"]);
}
