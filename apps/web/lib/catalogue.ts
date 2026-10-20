import "server-only";
import { bestOffer, type ProductCategory, type Specs } from "@goinstall/core";
import type { Tx } from "@goinstall/db";

export interface CatalogueOffer {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string | null;
  costPence: number | null;
  stockQty: number | null;
  leadTimeDays: number | null;
  source: string;
  pricedAt: Date;
}

export interface CatalogueProduct {
  id: string;
  category: ProductCategory;
  name: string;
  make: string | null;
  model: string;
  sku: string | null;
  unit: string;
  specs: Specs;
  sellPence: number | null;
  archived: boolean;
  offers: CatalogueOffer[];
  best: CatalogueOffer | null;
}

/** The catalogue with every supplier's offer and the default pick (cheapest in stock). */
export async function listCatalogue(tx: Tx, opts: { includeArchived?: boolean; categories?: ProductCategory[] } = {}): Promise<CatalogueProduct[]> {
  let q = tx.selectFrom("products").selectAll().orderBy("category").orderBy("name");
  if (!opts.includeArchived) q = q.where("archived_at", "is", null);
  if (opts.categories?.length) q = q.where("category", "in", opts.categories);
  const [products, offers] = await Promise.all([
    q.execute(),
    tx
      .selectFrom("supplier_products as sp")
      .innerJoin("suppliers as s", "s.id", "sp.supplier_id")
      .select(["sp.id", "sp.product_id", "sp.supplier_id", "s.name as supplier_name", "sp.supplier_sku", "sp.cost_pence", "sp.stock_qty", "sp.lead_time_days", "sp.source", "sp.priced_at"])
      .where("s.archived_at", "is", null)
      .orderBy("s.name")
      .execute(),
  ]);
  return products.map((p) => {
    const mine: CatalogueOffer[] = offers
      .filter((o) => o.product_id === p.id)
      .map((o) => ({
        id: o.id,
        supplierId: o.supplier_id,
        supplierName: o.supplier_name,
        supplierSku: o.supplier_sku,
        costPence: o.cost_pence === null ? null : Number(o.cost_pence),
        stockQty: o.stock_qty,
        leadTimeDays: o.lead_time_days,
        source: o.source,
        pricedAt: o.priced_at,
      }));
    return {
      id: p.id,
      category: p.category,
      name: p.name,
      make: p.make,
      model: p.model,
      sku: p.sku,
      unit: p.unit,
      specs: (p.specs ?? {}) as Specs,
      sellPence: p.sell_price_pence === null ? null : Number(p.sell_price_pence),
      archived: p.archived_at !== null,
      offers: mine,
      best: bestOffer(mine),
    };
  });
}
