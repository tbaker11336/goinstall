"use server";

import { enquiryFormConfig, OPTIONAL_FIELDS } from "@goinstall/core";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/auth";
import type { ActionResult } from "./crm";

/** Save the hosted enquiry form (Settings › Marketing). Bad values fall back to the defaults. */
export async function saveEnquiryFormAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const config = enquiryFormConfig({
    heading: form.get("heading"),
    intro: form.get("intro"),
    fields: Object.fromEntries(OPTIONAL_FIELDS.map((k) => [k, form.get(`field_${k}`)])),
    products: form.getAll("products").map(String),
    buttonText: form.get("buttonText"),
    thankYou: form.get("thankYou"),
  });
  return asUser(async (tx, session) => {
    await tx.updateTable("companies").set({ enquiry_form: JSON.stringify(config) }).where("id", "=", session.companyId).execute();
    revalidatePath("/settings/marketing");
    return { message: "Form saved. Your website shows the changes straight away." };
  }, ["admin"]);
}
