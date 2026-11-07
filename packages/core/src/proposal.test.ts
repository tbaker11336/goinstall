import { describe, expect, it } from "vitest";
import { buildLinesFromDesigns, customerLines, jobProfit, lineTotal, paybackYears, proposalReference, proposalTotals, type CatalogueItem, type DraftLine } from "./proposal";

const item = (id: string, name: string, category: CatalogueItem["category"], sellPence: number | null): CatalogueItem => ({ id, name, category, sellPence });

describe("proposal totals", () => {
  // The worked example in the proposal design (docs/design/09): EV lines at 20%, the rest at 0%.
  const lines = [
    { quantity: 18, unitPricePence: 16500, vatRate: 0 }, // £2,970
    { quantity: 1, unitPricePence: 145000, vatRate: 0 },
    { quantity: 1, unitPricePence: 78000, vatRate: 0 },
    { quantity: 1, unitPricePence: 390000, vatRate: 0 },
    { quantity: 1, unitPricePence: 69000, vatRate: 20 },
    { quantity: 1, unitPricePence: 42000, vatRate: 20 },
    { quantity: 1, unitPricePence: 391800, vatRate: 0 },
    { quantity: 1, unitPricePence: 65000, vatRate: 0 },
    { quantity: 1, unitPricePence: -15000, vatRate: 0 },
  ];
  it("matches the design: £14,628 + £222 VAT = £14,850, 25% deposit £3,712.50", () => {
    expect(proposalTotals(lines, 25)).toMatchObject({ subtotalPence: 1462800, vatPence: 22200, totalPence: 1485000, depositPence: 371250, balancePence: 1113750 });
  });
  it("breaks VAT down by rate", () => {
    expect(proposalTotals(lines, 25).vatByRate).toEqual([
      { rate: 0, netPence: 1351800, vatPence: 0 },
      { rate: 20, netPence: 111000, vatPence: 22200 },
    ]);
  });
  it("rounds fractional quantities to the penny", () => expect(lineTotal({ quantity: 2.5, unitPricePence: 333 })).toBe(833));
});

describe("lines from designs", () => {
  const panel = item("p", "445 W all-black panel", "panel", 16500);
  const inverter = item("i", "5 kW hybrid inverter", "inverter", 145000);
  const battery = item("b", "10 kWh battery", "battery", 390000);
  const charger = item("c", "7 kW tethered charger", "ev_charger", 69000);
  it("builds sectioned lines with each category's VAT rate and the shared-visit discount", () => {
    const { lines, notes } = buildLinesFromDesigns({
      solar: { panel, panelCount: 18, kWp: 8.01, inverter, battery, batteryCount: 1 },
      ev: { charger, routeLengthM: 12.4 },
      vatRates: { panel: 0, inverter: 0, battery: 0, ev_charger: 20, labour: 0 },
      sharedVisitDiscountPence: 15000,
    });
    expect(notes).toEqual([]);
    expect(lines.map((l) => [l.section, l.description, l.quantity, l.unitPricePence, l.vatRate])).toEqual([
      ["solar", "445 W all-black panel (8.01 kWp)", 18, 16500, 0],
      ["solar", "5 kW hybrid inverter", 1, 145000, 0],
      ["battery", "10 kWh battery", 1, 390000, 0],
      ["ev", "7 kW tethered charger, 12.4 m cable run", 1, 69000, 20],
      ["installation", "Single visit for solar and EV", 1, -15000, 0],
    ]);
  });
  it("reports missing VAT rates and prices instead of assuming them", () => {
    const { notes } = buildLinesFromDesigns({ solar: null, ev: { charger: item("c", "Charger", "ev_charger", null), routeLengthM: null }, vatRates: {}, sharedVisitDiscountPence: null });
    expect(notes).toEqual(["Charger has no sell price in the catalogue.", "Set the VAT rate for ev charger products in Settings › Invoices & quotes."]);
  });
});

describe("helpers", () => {
  it("formats references", () => {
    expect(proposalReference("Q-", 142, 2)).toBe("Q-0142 · v2");
    expect(proposalReference(null, 7)).toBe("Q-0007");
  });
  it("works out payback", () => {
    expect(paybackYears(1485000, 142000)).toBe(10.5);
    expect(paybackYears(1485000, null)).toBeNull();
  });
});

describe("proposal finance", () => {
  it("needs the inputs and the price", async () => {
    const { financeForSummary } = await import("./proposal-summary");
    const { DEFAULT_FINANCE, monthlyConsumption } = await import("./finance");
    const base = { kWp: 7.885, panelCount: 19, annualKwh: 6858, selfUse: 0.76, yearlySavingPence: null, evRouteM: null, segments: [] };
    expect(financeForSummary(base, 2_250_000).missing).toEqual(["the customer's electricity use", "the tariff (unit rate, standing charge, export)", "finance assumptions"]);
    const full = {
      ...base,
      energy: { annualKwh: 8700, monthlyKwh: null, consumption: monthlyConsumption({ annualKwh: 8700 }), tariff: { unitRatePence: 36, standingChargePencePerDay: 100, exportRatePence: 6 }, tariffName: null, source: "bills" },
      assumptions: DEFAULT_FINANCE,
      emissions: { kgPerKwh: 0.1, source: "test" },
    };
    const r = financeForSummary(full, 2_250_000);
    expect(r.missing).toEqual([]);
    expect(r.finance!.firstYear.totals.savingPct).toBeCloseTo(0.565, 2);
    expect(r.finance!.co2KgPerYear).toBe(686);
    expect(r.finance!.cashFlow.rows[0]!.totalPence).toBe(-2_250_000);
  });
});

describe("line display", () => {
  it("hides only fully hidden lines from the customer; totals still count them", () => {
    const base = { section: "installation" as const, productId: null, quantity: 1, vatRate: 0, origin: "custom" as const };
    const lines: DraftLine[] = [
      { ...base, description: "Charger", unitPricePence: 50_000 },
      { ...base, description: "Fitting", unitPricePence: 20_000, display: "hide_price" },
      { ...base, description: "Certificates", unitPricePence: 5_000, display: "hide" },
    ];
    expect(customerLines(lines).map((l) => l.description)).toEqual(["Charger", "Fitting"]);
    expect(proposalTotals(lines, 0).totalPence).toBe(75_000);
  });
});

describe("job profit", () => {
  it("takes each product's purchase cost from revenue before VAT, lists lines with no cost, and counts discounts", () => {
    const costs = new Map([
      ["panel", 9_000],
      ["inverter", 60_000],
    ]);
    const p = jobProfit(
      [
        { productId: "panel", description: "12 panels", quantity: 12, unitPricePence: 15_000 },
        { productId: "inverter", description: "Inverter", quantity: 1, unitPricePence: 90_000 },
        { productId: null, description: "Installation labour", quantity: 1, unitPricePence: 80_000 },
        { productId: null, description: "Single visit", quantity: 1, unitPricePence: -10_000 },
      ],
      costs,
    );
    expect(p.revenuePence).toBe(180_000 + 90_000 + 80_000 - 10_000);
    expect(p.costPence).toBe(108_000 + 60_000);
    expect(p.profitPence).toBe(340_000 - 168_000);
    expect(p.margin).toBeCloseTo(172_000 / 340_000);
    expect(p.uncosted).toEqual([{ description: "Installation labour", netPence: 80_000 }]);
  });

  it("has no margin without revenue", () => {
    expect(jobProfit([], new Map()).margin).toBeNull();
  });
});
