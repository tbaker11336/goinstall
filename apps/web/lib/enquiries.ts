import "server-only";
import { sql, withService } from "@goinstall/db";
import { db } from "./db";

export interface EnquiryInput {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  town: string | null;
  postcode: string | null;
  products: ("solar" | "battery" | "ev")[];
  message: string | null;
  source: string | null;
}

/**
 * A website enquiry (the public endpoint or the hosted form): finds the
 * company by its form key, reuses the contact by email or creates one, and
 * adds a new enquiry project. Runs as the service role: the form key is the
 * only credential, and everything is scoped to that company. False when the
 * key is unknown.
 */
export async function createEnquiry(e: EnquiryInput): Promise<boolean> {
  return withService(db(), async (tx) => {
    const company = await tx
      .selectFrom("companies")
      .select("id")
      .where("enquiry_form_key", "=", e.key)
      .executeTakeFirst();
    if (!company) return false;

    const existing = e.email
      ? await tx
          .selectFrom("contacts")
          .select(["id", "interested_in"])
          .where("company_id", "=", company.id)
          .where(sql`lower(email)`, "=", e.email)
          .executeTakeFirst()
      : undefined;

    const contactId =
      existing?.id ??
      (
        await tx
          .insertInto("contacts")
          .values({
            company_id: company.id,
            name: e.name,
            email: e.email,
            phone: e.phone,
            address_line1: e.address,
            town: e.town,
            postcode: e.postcode,
            source: e.source ?? "Website form",
            interested_in: e.products,
          })
          .returning("id")
          .executeTakeFirstOrThrow()
      ).id;

    if (
      existing &&
      e.products.some((p) => !existing.interested_in.includes(p))
    ) {
      await tx
        .updateTable("contacts")
        .set({
          interested_in: [
            ...new Set([...existing.interested_in, ...e.products]),
          ],
        })
        .where("id", "=", existing.id)
        .execute();
    }

    const project = await tx
      .insertInto("projects")
      .values({
        company_id: company.id,
        contact_id: contactId,
        products: e.products,
        site_address_line1: e.address,
        site_town: e.town,
        site_postcode: e.postcode,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    if (e.message) {
      await tx
        .insertInto("messages")
        .values({
          company_id: company.id,
          contact_id: contactId,
          project_id: project.id,
          channel: "note",
          direction: "internal",
          subject: "Website enquiry",
          body: e.message,
        })
        .execute();
    }
    return true;
  });
}
