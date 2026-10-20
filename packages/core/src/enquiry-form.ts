/**
 * The hosted website enquiry form a company builds in Settings › Marketing
 * and embeds on its own site. Stored per company as JSON; anything missing
 * falls back to the defaults.
 */
import type { Product } from "./survey";

export type FieldMode = "required" | "optional" | "hidden";
export const OPTIONAL_FIELDS = ["phone", "postcode", "address", "message"] as const;
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];

export const FIELD_LABELS: Record<OptionalField, string> = { phone: "Phone", postcode: "Postcode", address: "Address", message: "Message" };

export interface EnquiryFormConfig {
  heading: string;
  intro: string;
  fields: Record<OptionalField, FieldMode>;
  /** Products the visitor can tick; empty hides the question. */
  products: Product[];
  buttonText: string;
  thankYou: string;
}

export const DEFAULT_ENQUIRY_FORM: EnquiryFormConfig = {
  heading: "Get a free quote",
  intro: "Tell us a little about your home and we'll be in touch.",
  fields: { phone: "required", postcode: "required", address: "optional", message: "optional" },
  products: ["solar", "battery", "ev"],
  buttonText: "Send enquiry",
  thankYou: "Thanks, we've got your enquiry and will be in touch soon.",
};

const clip = (v: unknown, max: number, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback);
const MODES: FieldMode[] = ["required", "optional", "hidden"];

/** Stored JSON → a complete config (unknown or bad values take the default). */
export function enquiryFormConfig(raw: unknown): EnquiryFormConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof EnquiryFormConfig, unknown>>;
  const f = (r.fields && typeof r.fields === "object" ? r.fields : {}) as Record<string, unknown>;
  return {
    heading: clip(r.heading, 120, DEFAULT_ENQUIRY_FORM.heading),
    intro: typeof r.intro === "string" ? r.intro.trim().slice(0, 500) : DEFAULT_ENQUIRY_FORM.intro,
    fields: Object.fromEntries(OPTIONAL_FIELDS.map((k) => [k, MODES.includes(f[k] as FieldMode) ? (f[k] as FieldMode) : DEFAULT_ENQUIRY_FORM.fields[k]])) as Record<OptionalField, FieldMode>,
    products: Array.isArray(r.products) ? (["solar", "battery", "ev"] as Product[]).filter((p) => (r.products as unknown[]).includes(p)) : DEFAULT_ENQUIRY_FORM.products,
    buttonText: clip(r.buttonText, 40, DEFAULT_ENQUIRY_FORM.buttonText),
    thankYou: clip(r.thankYou, 300, DEFAULT_ENQUIRY_FORM.thankYou),
  };
}

/** Check a submission against the form: required fields filled, only offered products. */
export function checkEnquiry(config: EnquiryFormConfig, v: { name: string; email: string; phone: string; postcode: string; address: string; message: string; products: string[] }): { ok: true; products: Product[] } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!v.name.trim()) errors.name = "Enter your name";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) errors.email = "Enter a valid email address";
  for (const k of OPTIONAL_FIELDS) if (config.fields[k] === "required" && !v[k].trim()) errors[k] = `Enter your ${FIELD_LABELS[k].toLowerCase()}`;
  const products = config.products.filter((p) => v.products.includes(p));
  if (config.products.length && !products.length) errors.products = "Choose what you're interested in";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, products };
}

/** The snippet a company pastes into its website. */
export function embedSnippet(siteUrl: string, key: string) {
  const base = siteUrl.replace(/\/$/, "");
  return `<div data-goinstall-form="${key}"></div>\n<script src="${base}/embed/enquiry.js" async></script>`;
}
