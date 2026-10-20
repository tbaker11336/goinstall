import { describe, expect, it } from "vitest";
import { cashFlow, DEFAULT_FINANCE, firstYear, monthlyConsumption, paybackLabel, spreadByMonth } from "./finance";

// The business's example (54 Firs Road): 6,858 kWh MCS, 8,700 kWh use, 76%
// self-consumption with battery, 36p unit rate, £1/day standing, 6p export.
const tariff = { unitRatePence: 36, standingChargePencePerDay: 100, exportRatePence: 6 };

describe("finance", () => {
  it("spreads an annual figure by a monthly shape or by days", () => {
    const m = spreadByMonth(1200, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(m.every((x) => x === 100)).toBe(true);
    const byDays = spreadByMonth(365.25);
    expect(byDays[0]).toBeCloseTo(31);
    expect(monthlyConsumption({ annualKwh: null, monthlyKwh: null })).toBeNull();
    expect(monthlyConsumption({ monthlyKwh: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })![11]).toBe(12);
  });

  it("works out bills before and after", () => {
    const fy = firstYear({ annualGenerationKwh: 6858, consumption: monthlyConsumption({ annualKwh: 8700 })!, selfConsumption: 0.76, tariff });
    // Before: 8,700 × 36p + 365.25 × £1 = £3,497.25.
    expect(Math.abs(fy.totals.billBeforePence - 349725)).toBeLessThanOrEqual(6); // months round to the penny
    expect(fy.totals.selfUseKwh).toBe(5212);
    expect(fy.totals.exportKwh).toBe(1646);
    // After: (8,700 − 5,212) × 36p + £365.25 − 1,646 × 6p ≈ £1,522.
    expect(Math.abs(fy.totals.billAfterPence - 152217)).toBeLessThan(150);
    expect(fy.totals.savingPct).toBeCloseTo(0.565, 2);
    expect(fy.totals.selfSufficiency).toBeCloseTo(0.6, 1);
  });

  it("builds a 20-year cash flow with NPV, IRR and payback", () => {
    const fy = firstYear({ annualGenerationKwh: 6858, consumption: monthlyConsumption({ annualKwh: 8700 })!, selfConsumption: 0.76, tariff });
    const cf = cashFlow({ costPence: 2_250_000, firstYear: fy, tariff, assumptions: DEFAULT_FINANCE });
    expect(cf.rows).toHaveLength(21);
    expect(cf.rows[0]!.totalPence).toBe(-2_250_000);
    expect(cf.rows[1]!.generationKwh).toBe(Math.round(6858 * 0.98));
    // Year 2 loses a further 0.55%.
    expect(cf.rows[2]!.generationKwh).toBe(Math.round(6858 * 0.98 * 0.9945));
    expect(cf.rows.at(-1)!.cumulativePence).toBe(cf.rows.reduce((n, r) => n + r.totalPence, 0));
    expect(cf.simplePaybackYears).toBeGreaterThan(8);
    expect(cf.discountedPaybackYears).toBeGreaterThan(cf.simplePaybackYears!);
    expect(cf.irr).toBeGreaterThan(0.05);
    expect(cf.npvPence).toBeGreaterThan(0);
    // NPV at the IRR (rounded to 0.01%) is within £20 of zero.
    const r = cf.irr!;
    expect(Math.abs(cf.rows.reduce((n, row) => n + row.totalPence / (1 + r) ** row.year, 0))).toBeLessThan(2000);
  });

  it("says when the cost isn't repaid", () => {
    const fy = firstYear({ annualGenerationKwh: 500, consumption: monthlyConsumption({ annualKwh: 3000 })!, selfConsumption: 0.5, tariff });
    const cf = cashFlow({ costPence: 5_000_000, firstYear: fy, tariff, assumptions: DEFAULT_FINANCE });
    expect(cf.discountedPaybackYears).toBeNull();
    expect(paybackLabel(null)).toBe("Not within the system lifetime");
    expect(paybackLabel(10.4)).toBe("10–11 years");
  });
});
