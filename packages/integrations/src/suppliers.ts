/**
 * Supplier adapters. Every supplier implements the same interface whatever
 * its connection: an API, a price file the team uploads, or email only.
 * Price-file and email adapters come first; API adapters are added per
 * supplier as access is agreed (phase 6).
 */
import type { EmailSender, SendResult } from "./email";

export interface PriceAndStock {
  supplierSku: string;
  costPence: number | null;
  stockQty: number | null;
  leadTimeDays: number | null;
  /** When the figure was last updated (upload time for price files). */
  pricedAt: Date;
}

export interface PurchaseOrderLine {
  supplierSku: string | null;
  description: string;
  quantity: number;
  unitCostPence: number | null;
}

export interface PurchaseOrder {
  reference: string;
  companyName: string;
  deliveryAddress: string;
  requiredBy: Date | null;
  lines: PurchaseOrderLine[];
  notes?: string;
  replyTo?: string;
}

export type PlacedOrder = { ok: true; providerRef: string } | { ok: false; error: string };

export interface SupplierAdapter {
  readonly connection: "api" | "price_file" | "email";
  /** Live price and stock where the supplier offers it; stored figures otherwise. */
  getPriceAndStock(skus: string[]): Promise<PriceAndStock[]>;
  placeOrder(po: PurchaseOrder): Promise<PlacedOrder>;
  /** Only API suppliers report order status; others are updated by hand. */
  getOrderStatus?(providerRef: string): Promise<{ status: string; expectedDelivery: Date | null }>;
}

/** Plain-text purchase order, used in the email body (the PDF follows in phase 5). */
export function purchaseOrderText(po: PurchaseOrder): string {
  const money = (p: number | null) => (p === null ? "" : `£${(p / 100).toFixed(2)}`);
  const lines = po.lines.map((l) => `${l.quantity} × ${l.description}${l.supplierSku ? ` [${l.supplierSku}]` : ""}${l.unitCostPence !== null ? ` @ ${money(l.unitCostPence)}` : ""}`);
  const total = po.lines.every((l) => l.unitCostPence !== null) ? po.lines.reduce((n, l) => n + l.quantity * l.unitCostPence!, 0) : null;
  return [
    `Purchase order ${po.reference} from ${po.companyName}`,
    "",
    ...lines,
    ...(total !== null ? ["", `Total (ex VAT): ${money(total)}`] : []),
    "",
    `Deliver to: ${po.deliveryAddress}`,
    ...(po.requiredBy ? [`Required by: ${po.requiredBy.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })}`] : []),
    ...(po.notes ? ["", po.notes] : []),
    "",
    "Please confirm the order and delivery date by replying to this email.",
  ].join("\n");
}

export interface OfflineSupplierOptions {
  connection: "price_file" | "email";
  /** Reads the latest uploaded or manually entered figures for these codes. */
  lookup: (skus: string[]) => Promise<PriceAndStock[]>;
  sender: EmailSender;
  from: string;
  orderEmail: string | null;
}

/** Price-file and email-only suppliers: stored prices, orders sent by email. */
export function createOfflineSupplier(opts: OfflineSupplierOptions): SupplierAdapter {
  return {
    connection: opts.connection,
    getPriceAndStock: (skus) => opts.lookup(skus),
    async placeOrder(po) {
      if (!opts.orderEmail) return { ok: false, error: "This supplier has no order email address. Add one in Settings › Products & suppliers." };
      const result: SendResult = await opts.sender.send({
        from: opts.from,
        to: opts.orderEmail,
        replyTo: po.replyTo,
        subject: `Purchase order ${po.reference} from ${po.companyName}`,
        text: purchaseOrderText(po),
        idempotencyKey: `po-${po.reference}`,
        tags: { kind: "purchase_order" },
      });
      return result.ok ? { ok: true, providerRef: result.providerId } : { ok: false, error: result.error };
    },
  };
}
