/**
 * Kit list rules: the kit comes from the accepted proposal's product lines;
 * each line is bought from the cheapest supplier with stock unless staff pick
 * another; orders are split one per supplier. Money is integer pence.
 */
import { bestOffer, type SupplierOffer } from "./catalogue";

export interface KitSource {
  productId: string | null;
  description: string;
  quantity: number;
  /** Proposal line total (ex VAT), for the margin. */
  lineTotalPence: number;
}

/** One kit line per product, quantities added up. Lines without a product (labour, discounts) aren't kit. */
export function kitFromProposal(lines: readonly KitSource[]): { productId: string; description: string; quantity: number; sellPence: number }[] {
  const out = new Map<string, { productId: string; description: string; quantity: number; sellPence: number }>();
  for (const l of lines) {
    if (!l.productId || l.quantity <= 0) continue;
    const k = out.get(l.productId);
    if (k) {
      k.quantity += l.quantity;
      k.sellPence += l.lineTotalPence;
    } else out.set(l.productId, { productId: l.productId, description: l.description.replace(/\s*\([^)]*kWp\)$/, ""), quantity: l.quantity, sellPence: l.lineTotalPence });
  }
  return [...out.values()];
}

/** The offer a kit line is bought from: the staff override if it has a price, else the default pick. */
export function chosenOffer<O extends SupplierOffer>(offers: readonly O[], quantity: number, overrideSupplierId: string | null): O | null {
  if (overrideSupplierId) {
    const o = offers.find((x) => x.supplierId === overrideSupplierId && x.costPence !== null);
    if (o) return o;
  }
  return bestOffer(offers, quantity);
}

export interface KitLine<O extends SupplierOffer = SupplierOffer> {
  id: string;
  quantity: number;
  sellPence: number | null;
  offer: O | null;
}

export function kitTotals(lines: readonly KitLine[]): { costPence: number; sellPence: number; marginPence: number; marginPct: number | null; unpriced: number } {
  let costPence = 0;
  let sellPence = 0;
  let unpriced = 0;
  for (const l of lines) {
    if (l.offer?.costPence == null) unpriced++;
    else costPence += Math.round(l.offer.costPence * l.quantity);
    sellPence += l.sellPence ?? 0;
  }
  const marginPence = sellPence - costPence;
  return { costPence, sellPence, marginPence, marginPct: sellPence > 0 ? Math.round((marginPence / sellPence) * 1000) / 10 : null, unpriced };
}

/** Group lines by chosen supplier, one purchase order each. Unpriced lines are left out and reported. */
export function splitOrders<L extends KitLine>(lines: readonly L[]): { orders: { supplierId: string; lines: L[]; totalPence: number }[]; unassigned: L[] } {
  const orders = new Map<string, { supplierId: string; lines: L[]; totalPence: number }>();
  const unassigned: L[] = [];
  for (const l of lines) {
    if (!l.offer || l.offer.costPence === null) {
      unassigned.push(l);
      continue;
    }
    const o = orders.get(l.offer.supplierId) ?? { supplierId: l.offer.supplierId, lines: [], totalPence: 0 };
    o.lines.push(l);
    o.totalPence += Math.round(l.offer.costPence * l.quantity);
    orders.set(l.offer.supplierId, o);
  }
  return { orders: [...orders.values()], unassigned };
}

/** PO-0311 style reference. */
export function purchaseOrderReference(prefix: string | null, n: number) {
  return `${(prefix || "PO").replace(/-$/, "")}-PO-${String(n).padStart(4, "0")}`;
}
