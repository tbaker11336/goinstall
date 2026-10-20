import { describe, expect, it } from "vitest";
import { chosenOffer, kitFromProposal, kitTotals, splitOrders } from "./kit";

const offer = (supplierId: string, costPence: number | null, stockQty: number | null, leadTimeDays: number | null = null) => ({ supplierId, costPence, stockQty, leadTimeDays });

describe("kit", () => {
  it("builds one line per product from the proposal, skipping labour and discounts", () => {
    const kit = kitFromProposal([
      { productId: "p", description: "445 W panel (8.01 kWp)", quantity: 18, lineTotalPence: 297000 },
      { productId: null, description: "Scaffolding", quantity: 1, lineTotalPence: 65000 },
      { productId: "p", description: "445 W panel", quantity: 2, lineTotalPence: 33000 },
    ]);
    expect(kit).toEqual([{ productId: "p", description: "445 W panel", quantity: 20, sellPence: 330000 }]);
  });

  it("uses the cheapest in-stock supplier unless staff override", () => {
    const offers = [offer("A", 9600, 100), offer("B", 9500, 0, 5), offer("C", 10100, 50)];
    expect(chosenOffer(offers, 18, null)?.supplierId).toBe("A");
    expect(chosenOffer(offers, 18, "C")?.supplierId).toBe("C");
    expect(chosenOffer([offer("A", null, 5)], 1, null)).toBeNull();
  });

  it("matches the design's kit cost and margin", () => {
    // Design 10: kit cost £6,203 against £9,790 of proposal lines → 36.6% · £3,587.
    const lines = [
      { id: "1", quantity: 18, sellPence: 297000, offer: offer("A", 9600, 100) },
      { id: "2", quantity: 1, sellPence: 145000, offer: offer("B", 89000, 3) },
      { id: "3", quantity: 1, sellPence: 390000, offer: offer("B", 265000, 3) },
      { id: "4", quantity: 1, sellPence: 78000 - 18500 - 0, offer: offer("A", 34000, 9) },
      { id: "5", quantity: 1, sellPence: 69000, offer: offer("C", 41000, 2) },
      { id: "6", quantity: 1, sellPence: 18500 - 9000 + 9000, offer: offer("A", 18500, 9) },
    ];
    const t = kitTotals(lines);
    expect(t.costPence).toBe(620300);
    expect(t.sellPence).toBe(979000);
    expect(t.marginPence).toBe(358700);
    expect(t.marginPct).toBe(36.6);
    const { orders } = splitOrders(lines);
    expect(orders.map((o) => [o.supplierId, o.totalPence])).toEqual([
      ["A", 225300],
      ["B", 354000],
      ["C", 41000],
    ]);
  });
});
