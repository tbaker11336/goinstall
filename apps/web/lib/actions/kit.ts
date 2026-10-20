"use server";

import { randomUUID } from "node:crypto";
import { formatPence, purchaseOrderReference, splitOrders } from "@goinstall/core";
import { sql } from "@goinstall/db";
import { createOfflineSupplier } from "@goinstall/integrations";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { emailSender, fromAddress } from "@/lib/email";
import { fileStore } from "@/lib/files";
import { loadKit } from "@/lib/kit";
import { renderPoPdf } from "@/lib/po-pdf";
import type { ActionResult } from "./crm";

const uuid = z.uuid();

/** Override (or reset to cheapest in stock) the supplier for a kit line. */
export async function setKitSupplierAction(itemId: string, supplierId: string | null): Promise<ActionResult> {
  if (!uuid.safeParse(itemId).success || (supplierId && !uuid.safeParse(supplierId).success)) return { error: "Not found" };
  return asUser(async (tx) => {
    const it = await tx.updateTable("kit_items").set({ supplier_id: supplierId }).where("id", "=", itemId).returning("project_id").executeTakeFirst();
    if (!it) return { error: "Not found" };
    revalidatePath(`/projects/${it.project_id}/kit`);
    return {};
  });
}

const orderSchema = z.object({
  deliver_to: z.enum(["site", "depot"]),
  expected_date: z.union([z.literal(""), z.iso.date()]).transform((v) => v || null),
  notes: z.string().trim().max(1000).transform((v) => v || null),
});

/**
 * "Place orders": one purchase order per supplier for kit not already on an
 * order, each emailed to the supplier as a PDF (price-file and email
 * suppliers). Orders a supplier can't receive stay as drafts.
 */
export async function placeOrdersAction(projectId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Project not found" };
  const parsed = orderSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const res = await asUser(async (tx, session) => {
    const project = await tx.selectFrom("projects").select(["id", "stage", "site_address_line1", "site_address_line2", "site_town", "site_postcode"]).where("id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    const company = await tx.selectFrom("companies").select(["name", "email", "phone", "document_prefix", "depot_address"]).executeTakeFirstOrThrow();
    const { rows } = await loadKit(tx, projectId);
    const ordered = new Set(
      (
        await tx
          .selectFrom("purchase_order_lines as l")
          .innerJoin("purchase_orders as po", "po.id", "l.purchase_order_id")
          .select("l.product_id")
          .where("po.project_id", "=", projectId)
          .where("po.status", "!=", "cancelled")
          .execute()
      ).map((r) => r.product_id),
    );
    const todo = rows.filter((r) => !ordered.has(r.productId));
    if (!todo.length) return { error: "Everything on the kit list is already on an order." };
    const { orders, unassigned } = splitOrders(todo);
    if (!orders.length) return { error: "No supplier prices for these items. Add them in Settings › Products & suppliers." };
    const address =
      parsed.data.deliver_to === "depot"
        ? company.depot_address
        : [project.site_address_line1, project.site_address_line2, project.site_town, project.site_postcode].filter(Boolean).join(", ");
    if (!address) return { error: parsed.data.deliver_to === "depot" ? "Add your depot address in Settings › Company details first." : "The project has no site address." };

    const results: string[] = [];
    for (const o of orders) {
      const supplier = await tx.selectFrom("suppliers").select(["id", "name", "connection", "order_email", "account_number"]).where("id", "=", o.supplierId).executeTakeFirstOrThrow();
      const n = (await sql<{ n: number }>`select public.next_document_number('purchase_order') as n`.execute(tx)).rows[0]!.n;
      const reference = purchaseOrderReference(company.document_prefix, n);
      const lines = o.lines.map((l) => ({ description: l.description, sku: l.offer!.supplierSku, quantity: l.quantity, unitCostPence: l.offer!.costPence! }));
      const po = await tx
        .insertInto("purchase_orders")
        .values({ project_id: projectId, supplier_id: supplier.id, number: reference, deliver_to: parsed.data.deliver_to, delivery_address: address, expected_date: parsed.data.expected_date, total_pence: o.totalPence, notes: parsed.data.notes })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("purchase_order_lines")
        .values(o.lines.map((l, i) => ({ purchase_order_id: po.id, product_id: l.productId, supplier_sku: l.offer!.supplierSku, description: l.description, quantity: l.quantity, unit_cost_pence: l.offer!.costPence!, line_total_pence: Math.round(l.quantity * l.offer!.costPence!), position: i })))
        .execute();

      const pdf = await renderPoPdf({
        reference,
        companyName: company.name,
        companyContact: [company.phone, company.email].filter((v): v is string => Boolean(v)),
        supplierName: supplier.name,
        accountNumber: supplier.account_number,
        deliveryAddress: address,
        expectedDate: parsed.data.expected_date,
        lines,
        notes: parsed.data.notes,
      });
      const fileId = randomUUID();
      const path = `${session.companyId}/${projectId}/${fileId}.pdf`;
      await fileStore().put(path, new Uint8Array(pdf), "application/pdf");
      await tx
        .insertInto("files")
        .values({ id: fileId, project_id: projectId, kind: "purchase_order", path, content_type: "application/pdf", size_bytes: pdf.length, original_name: `${reference}.pdf`, source: "staff", uploaded_by: session.userId })
        .execute();
      await tx.updateTable("purchase_orders").set({ file_id: fileId }).where("id", "=", po.id).execute();

      // API suppliers arrive with their adapters (phase 6); until then every order is emailed.
      const adapter = createOfflineSupplier({ connection: "email", lookup: async () => [], sender: emailSender(), from: fromAddress(company.name), orderEmail: supplier.order_email });
      const placed = await adapter.placeOrder({
        reference,
        companyName: company.name,
        deliveryAddress: address,
        requiredBy: parsed.data.expected_date ? new Date(parsed.data.expected_date) : null,
        lines: lines.map((l) => ({ supplierSku: l.sku, description: l.description, quantity: l.quantity, unitCostPence: l.unitCostPence })),
        notes: parsed.data.notes ?? undefined,
        replyTo: session.email || company.email || undefined,
        pdf: new Uint8Array(pdf),
      });
      if (placed.ok) {
        await tx.updateTable("purchase_orders").set({ status: "sent", sent_at: sql<Date>`now()` }).where("id", "=", po.id).execute();
        results.push(`${reference} emailed to ${supplier.name} (${formatPence(o.totalPence)})`);
      } else results.push(`${reference} for ${supplier.name} saved as a draft: ${placed.error}`);
    }
    if (["deposit_paid", "accepted"].includes(project.stage)) await tx.updateTable("projects").set({ stage: "kit_ordered" }).where("id", "=", projectId).execute();
    await tx.insertInto("activity_log").values({ project_id: projectId, actor_id: session.userId, event: "kit_ordered", payload: { orders: orders.length } }).execute();
    const skipped = unassigned.length ? ` Not ordered (no supplier price): ${unassigned.map((u) => u.description).join(", ")}.` : "";
    return { message: `${results.join(". ")}.${skipped}` };
  });
  revalidatePath(`/projects/${projectId}`, "layout");
  return res;
}

const STATUS_FLOW = { sent: ["confirmed", "delivered", "cancelled"], draft: ["cancelled"], confirmed: ["delivered", "cancelled"], delivered: [], cancelled: [] } as const;

export async function setPurchaseOrderStatusAction(poId: string, status: "confirmed" | "delivered" | "cancelled"): Promise<ActionResult> {
  if (!uuid.safeParse(poId).success) return { error: "Order not found" };
  return asUser(async (tx) => {
    const po = await tx.selectFrom("purchase_orders").select(["id", "status", "project_id"]).where("id", "=", poId).executeTakeFirst();
    if (!po) return { error: "Order not found" };
    if (!(STATUS_FLOW[po.status] as readonly string[]).includes(status)) return { error: `A ${po.status} order can't be marked ${status}.` };
    await tx
      .updateTable("purchase_orders")
      .set({ status, ...(status === "delivered" ? { delivered_at: sql<Date>`now()` } : {}) })
      .where("id", "=", poId)
      .execute();
    revalidatePath(`/projects/${po.project_id}`, "layout");
    return {};
  });
}
