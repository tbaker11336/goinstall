import { enquiryFormConfig } from "@goinstall/core";
import { withService } from "@goinstall/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { EnquiryForm } from "./enquiry-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Get a quote", robots: { index: false, follow: false } };

/** The hosted enquiry form, shown on its own or inside a company's website (see /embed/enquiry.js). */
export default async function HostedEnquiryForm({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ preview?: string; embed?: string }> }) {
  const { key } = await params;
  const { preview, embed } = await searchParams;
  if (!/^[a-f0-9]{32}$/.test(key)) notFound();
  const company = await withService(db(), (tx) => tx.selectFrom("companies").select(["name", "enquiry_form", "brand_primary_colour"]).where("enquiry_form_key", "=", key).executeTakeFirst());
  if (!company) notFound();
  const accent = company.brand_primary_colour && /^#[0-9a-f]{6}$/i.test(company.brand_primary_colour) ? company.brand_primary_colour : null;
  const style = accent ? ({ "--primary": accent, "--primary-hover": accent, "--ring": accent } as React.CSSProperties) : undefined;
  return (
    <main style={style} className={embed ? "bg-transparent p-1" : "mx-auto min-h-dvh max-w-lg bg-background px-4 py-10"}>
      <EnquiryForm formKey={key} config={enquiryFormConfig(company.enquiry_form)} preview={preview === "1"} />
      {!embed && <p className="mt-3 text-center text-xs text-muted-foreground">{company.name}</p>}
    </main>
  );
}
