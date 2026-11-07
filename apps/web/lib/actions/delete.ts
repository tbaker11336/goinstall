"use server";

import type { Tx } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { fileStore } from "@/lib/files";
import type { ActionResult } from "./crm";

const uuid = z.uuid();

/**
 * Issued invoices are tax records, so a project with any invoice that isn't
 * void is kept (mark it lost instead, or void the invoices first).
 */
async function blockingInvoices(tx: Tx, projectIds: string[]) {
  if (!projectIds.length) return [];
  return tx.selectFrom("invoices").select(["number", "status"]).where("project_id", "in", projectIds).where("status", "!=", "void").execute();
}

function refusal(invoices: { number: string; status: string }[]) {
  const paid = invoices.some((i) => i.status === "paid");
  return `It has invoices (${invoices.map((i) => i.number).join(", ")}), which are kept for your accounts. ${paid ? "Mark the project lost instead." : "Void them on the Invoices tab first, or mark the project lost instead."}`;
}

/** The stored files under these projects, removed from storage once the rows are gone. */
async function filePaths(tx: Tx, projectIds: string[]) {
  if (!projectIds.length) return [];
  return (await tx.selectFrom("files").select("path").where("project_id", "in", projectIds).execute()).map((f) => f.path);
}

async function removeFiles(paths: string[]) {
  const store = fileStore();
  // Best effort: a file that's already gone is fine.
  await Promise.allSettled(paths.map((p) => store.remove(p)));
}

/** Delete a project and everything on it (admins only). The contact and their messages stay. */
export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Project not found" };
  const r = await asUser(
    async (tx) => {
      const p = await tx.selectFrom("projects").select(["id", "contact_id"]).where("id", "=", projectId).executeTakeFirst();
      if (!p) return { error: "Project not found" };
      const invoices = await blockingInvoices(tx, [p.id]);
      if (invoices.length) return { error: `This project can't be deleted. ${refusal(invoices)}` };
      const paths = await filePaths(tx, [p.id]);
      const gone = await tx.deleteFrom("projects").where("id", "=", p.id).executeTakeFirst();
      if (!gone.numDeletedRows) return { error: "Only an admin can delete a project." };
      return { paths, contactId: p.contact_id };
    },
    ["admin"],
  );
  if ("error" in r) return { error: r.error };
  await removeFiles(r.paths);
  revalidatePath("/", "layout");
  redirect(`/contacts/${r.contactId}`);
}

/** Delete a contact, their projects and their message history (admins only; UK GDPR erasure). */
export async function deleteContactAction(contactId: string): Promise<ActionResult> {
  if (!uuid.safeParse(contactId).success) return { error: "Contact not found" };
  const r = await asUser(
    async (tx) => {
      const c = await tx.selectFrom("contacts").select("id").where("id", "=", contactId).executeTakeFirst();
      if (!c) return { error: "Contact not found" };
      const projects = (await tx.selectFrom("projects").select("id").where("contact_id", "=", c.id).execute()).map((p) => p.id);
      const invoices = await blockingInvoices(tx, projects);
      if (invoices.length) return { error: `This contact can't be deleted. ${refusal(invoices)}` };
      const paths = await filePaths(tx, projects);
      // Projects first (their cascades), then the contact with its messages and activity.
      if (projects.length) await tx.deleteFrom("projects").where("id", "in", projects).execute();
      const gone = await tx.deleteFrom("contacts").where("id", "=", c.id).executeTakeFirst();
      if (!gone.numDeletedRows) return { error: "Only an admin can delete a contact." };
      return { paths };
    },
    ["admin"],
  );
  if ("error" in r) return { error: r.error };
  await removeFiles(r.paths);
  revalidatePath("/", "layout");
  redirect("/contacts");
}
