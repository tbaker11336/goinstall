"use server";

import { checkEnquiry, enquiryFormConfig } from "@goinstall/core";
import { withService } from "@goinstall/db";
import { z } from "zod";
import { db } from "@/lib/db";
import { createEnquiry } from "@/lib/enquiries";

export interface EnquiryFormState {
  ok?: boolean;
  error?: string;
  errors?: Record<string, string>;
}

const str = (form: FormData, k: string, max: number) => String(form.get(k) ?? "").slice(0, max);

/** Hosted form submit. Bots fill the hidden field or submit instantly; they get a fake success. */
export async function submitEnquiryFormAction(key: string, _: EnquiryFormState, form: FormData): Promise<EnquiryFormState> {
  if (!/^[a-f0-9]{32}$/.test(key)) return { error: "This form isn't available." };
  const renderedAt = Number(form.get("_t"));
  if (str(form, "website", 200) || (Number.isFinite(renderedAt) && Date.now() - renderedAt < 2000)) return { ok: true };
  const company = await withService(db(), (tx) => tx.selectFrom("companies").select(["id", "enquiry_form"]).where("enquiry_form_key", "=", key).executeTakeFirst());
  if (!company) return { error: "This form isn't available." };
  const config = enquiryFormConfig(company.enquiry_form);
  const v = {
    name: str(form, "name", 200),
    email: str(form, "email", 320),
    phone: str(form, "phone", 40),
    postcode: str(form, "postcode", 10),
    address: str(form, "address", 300),
    message: str(form, "message", 5000),
    products: form.getAll("products").map(String),
  };
  const checked = checkEnquiry(config, v);
  if (!checked.ok) return { error: "Please check the highlighted fields.", errors: checked.errors };
  const blank = (s: string) => s.trim() || null;
  const ok = await createEnquiry({
    key,
    name: v.name.trim(),
    email: z.email().safeParse(v.email.trim()).success ? v.email.trim().toLowerCase() : null,
    phone: blank(v.phone),
    address: blank(v.address),
    town: null,
    postcode: blank(v.postcode)?.toUpperCase() ?? null,
    products: checked.products,
    message: blank(v.message),
    source: "Website form",
  });
  return ok ? { ok: true } : { error: "This form isn't available." };
}
