"use server";

import { IMPORT_FIELDS, mapImportRows, parseCsv, parsePence, parseSpecs, PRODUCT_CATEGORIES, SPEC_FIELDS, type ColumnMapping, type ProductCategory } from "@goinstall/core";
import { pgErrorCode, sql } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import type { ActionResult } from "./crm";

const ADMIN = ["admin"] as const;
const text = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const orNull = (v: string) => v || null;

function done(message: string): ActionResult {
  revalidatePath("/settings/products");
  return { message };
}

const productSchema = z.object({
  category: z.enum(PRODUCT_CATEGORIES),
  name: z.string().trim().min(1, "Enter the name used on proposals").max(200),
  make: z.string().trim().max(100),
  model: z.string().trim().min(1, "Enter the model").max(100),
  sku: z.string().trim().max(100),
  unit: z.enum(["each", "kit", "metre", "hour", "day"]),
});

/** Add or edit a catalogue product, including the specs the calculations use. */
export async function saveProductAction(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = productSchema.safeParse(Object.fromEntries(["category", "name", "make", "model", "sku", "unit"].map((k) => [k, text(form, k)])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const sell = parsePence(text(form, "sell_price"));
  if (Number.isNaN(sell)) return { error: "Sell price: enter an amount like 165 or 165.00" };
  const category = parsed.data.category as ProductCategory;
  const specs = parseSpecs(category, Object.fromEntries((SPEC_FIELDS[category] ?? []).map((f) => [f.key, text(form, `spec_${f.key}`)])));
  if ("error" in specs) return { error: specs.error };
  const values = { ...parsed.data, make: orNull(parsed.data.make), sku: orNull(parsed.data.sku), sell_price_pence: sell, specs: JSON.stringify(specs.specs) };
  try {
    return await asUser(async (tx) => {
      if (id) {
        const r = await tx.updateTable("products").set(values).where("id", "=", z.uuid().parse(id)).executeTakeFirst();
        if (!r.numUpdatedRows) return { error: "Product not found" };
        return done("Product saved.");
      }
      await tx.insertInto("products").values(values).execute();
      return done("Product added.");
    }, [...ADMIN]);
  } catch (err) {
    if (pgErrorCode(err) === "23505") return { error: "A product with that make and model, or that code, already exists." };
    throw err;
  }
}

export async function setProductArchivedAction(id: string, archived: boolean): Promise<ActionResult> {
  return asUser(async (tx) => {
    await tx.updateTable("products").set({ archived_at: archived ? sql<Date>`now()` : null }).where("id", "=", z.uuid().parse(id)).execute();
    return done(archived ? "Product archived." : "Product restored.");
  }, [...ADMIN]);
}

const supplierSchema = z.object({
  name: z.string().trim().min(1, "Enter the supplier's name").max(100),
  connection: z.enum(["price_file", "email"]),
  order_email: z.union([z.literal(""), z.email("Enter a valid order email")]).transform(orNull),
  account_number: z.string().trim().max(60).transform(orNull),
});

/** API suppliers are added per supplier once access is agreed (phase 6). */
export async function saveSupplierAction(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = supplierSchema.safeParse(Object.fromEntries(["name", "connection", "order_email", "account_number"].map((k) => [k, text(form, k)])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  try {
    return await asUser(async (tx) => {
      if (id) await tx.updateTable("suppliers").set(parsed.data).where("id", "=", z.uuid().parse(id)).execute();
      else await tx.insertInto("suppliers").values(parsed.data).execute();
      return done(id ? "Supplier saved." : "Supplier added.");
    }, [...ADMIN]);
  } catch (err) {
    if (pgErrorCode(err) === "23505") return { error: "There's already a supplier with that name." };
    throw err;
  }
}

const offerSchema = z.object({
  supplier_id: z.uuid("Choose a supplier"),
  supplier_sku: z.string().trim().max(100).transform(orNull),
  stock: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), "Stock: enter a whole number"),
  lead_time_days: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), "Lead time: enter a whole number of days"),
});

/** Set one supplier's cost, stock and lead time for a product (manual entry). */
export async function saveOfferAction(productId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = offerSchema.safeParse(Object.fromEntries(["supplier_id", "supplier_sku", "stock", "lead_time_days"].map((k) => [k, text(form, k)])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const cost = parsePence(text(form, "cost"));
  if (Number.isNaN(cost)) return { error: "Cost: enter an amount like 96 or 96.00" };
  const values = {
    supplier_sku: parsed.data.supplier_sku,
    cost_pence: cost,
    stock_qty: parsed.data.stock,
    lead_time_days: parsed.data.lead_time_days,
    source: "manual" as const,
    priced_at: sql<Date>`now()`,
  };
  try {
    return await asUser(async (tx) => {
      await tx
        .insertInto("supplier_products")
        .values({ ...values, supplier_id: parsed.data.supplier_id, product_id: z.uuid().parse(productId) })
        .onConflict((oc) => oc.columns(["company_id", "supplier_id", "product_id"]).doUpdateSet(values))
        .execute();
      return done("Supplier price saved.");
    }, [...ADMIN]);
  } catch (err) {
    if (pgErrorCode(err) === "23505") return { error: "That supplier code is already used for another product." };
    throw err;
  }
}

export async function removeOfferAction(offerId: string): Promise<ActionResult> {
  return asUser(async (tx) => {
    await tx.deleteFrom("supplier_products").where("id", "=", z.uuid().parse(offerId)).execute();
    return done("Supplier price removed.");
  }, [...ADMIN]);
}

const MAX_CSV_CHARS = 2_000_000;

export interface ImportResult extends ActionResult {
  created?: number;
  updated?: number;
  prices?: number;
  skipped?: number;
}

/**
 * Import a CSV price file or catalogue. Rows match existing products by the
 * supplier's code, then by make and model; anything new is added. The same
 * mapping is applied server-side as in the preview.
 */
export async function importPriceFileAction(input: { csv: string; fileName: string; supplierId: string | null; mapping: ColumnMapping }): Promise<ImportResult> {
  if (typeof input.csv !== "string" || input.csv.length > MAX_CSV_CHARS) return { error: "That file is too large (2 MB maximum)." };
  const mapping: ColumnMapping = {};
  for (const f of IMPORT_FIELDS) {
    const v = input.mapping?.[f.key];
    if (v !== undefined && Number.isInteger(v) && v >= 0) mapping[f.key] = v;
  }
  if (mapping.model === undefined && mapping.supplier_sku === undefined) return { error: "Choose which column holds the model or supplier code." };
  const supplierId = input.supplierId ? z.uuid().parse(input.supplierId) : null;
  const [, ...dataRows] = parseCsv(input.csv);
  const { rows, errors } = mapImportRows(dataRows, mapping);
  if (!rows.length) return { error: errors.length ? `No rows could be imported. First problem, line ${errors[0]!.line}: ${errors[0]!.message}` : "The file has no rows." };
  if (!supplierId && rows.some((r) => r.costPence !== null || r.stockQty !== null)) {
    // Costs and stock only mean something per supplier.
    if (mapping.cost !== undefined || mapping.stock !== undefined) return { error: "Choose the supplier this price file is from, or unmap the cost and stock columns." };
  }

  return asUser(async (tx) => {
    let created = 0;
    let updated = 0;
    let prices = 0;
    for (const r of rows) {
      let productId: string | undefined;
      if (supplierId && r.supplierSku) {
        productId = (await tx.selectFrom("supplier_products").select("product_id").where("supplier_id", "=", supplierId).where("supplier_sku", "=", r.supplierSku).executeTakeFirst())?.product_id;
      }
      if (!productId) {
        productId = (
          await tx
            .selectFrom("products")
            .select("id")
            .where("archived_at", "is", null)
            .where(sql<boolean>`lower(coalesce(make, '')) = lower(${r.make ?? ""}) and lower(model) = lower(${r.model})`)
            .executeTakeFirst()
        )?.id;
      }
      if (productId) {
        const set: Record<string, unknown> = {};
        if (r.sellPence !== null) set.sell_price_pence = r.sellPence;
        if (Object.keys(r.specs).length) set.specs = sql`specs || ${JSON.stringify(r.specs)}::jsonb`;
        if (Object.keys(set).length) {
          await tx.updateTable("products").set(set).where("id", "=", productId).execute();
          updated++;
        }
      } else {
        productId = (
          await tx
            .insertInto("products")
            .values({ category: r.category, name: r.name, make: r.make, model: r.model, sell_price_pence: r.sellPence, specs: JSON.stringify(r.specs) })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
        created++;
      }
      if (supplierId && (r.costPence !== null || r.stockQty !== null || r.leadTimeDays !== null || r.supplierSku)) {
        const offer = { supplier_sku: r.supplierSku, cost_pence: r.costPence, stock_qty: r.stockQty, lead_time_days: r.leadTimeDays, source: "price_file" as const, priced_at: sql<Date>`now()` };
        await tx
          .insertInto("supplier_products")
          .values({ ...offer, supplier_id: supplierId, product_id: productId })
          .onConflict((oc) => oc.columns(["company_id", "supplier_id", "product_id"]).doUpdateSet(offer))
          .execute();
        prices++;
      }
    }
    if (supplierId) await tx.updateTable("suppliers").set({ last_sync_at: sql<Date>`now()` }).where("id", "=", supplierId).execute();
    await tx
      .insertInto("price_file_imports")
      .values({
        supplier_id: supplierId,
        file_name: input.fileName.slice(0, 200),
        mapping: JSON.stringify(mapping),
        rows_total: dataRows.length,
        products_created: created,
        products_updated: updated,
        prices_updated: prices,
        rows_skipped: errors.length,
      })
      .execute();
    revalidatePath("/settings/products");
    const skipped = errors.length ? `, ${errors.length} skipped` : "";
    return { message: `Imported: ${created} new, ${updated} updated, ${prices} supplier prices${skipped}.`, created, updated, prices, skipped: errors.length };
  }, [...ADMIN]);
}
