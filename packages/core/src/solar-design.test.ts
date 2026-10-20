import { describe, expect, it } from "vitest";
import { evaluateSolarDesign, type SolarDesignInput } from "./solar-design";

// SYNTHETIC rule tables: made-up values to test how the pieces combine.
const base: SolarDesignInput = {
  arrays: [
    { id: "A", label: "Roof A", pitch: 35, azimuth: 180, panelCount: 18, shadeFactor: 1 },
    { id: "B", label: "Roof B", pitch: 35, azimuth: 0, panelCount: 0, shadeFactor: 1 },
  ],
  panel: { specs: { watts_peak: 445, voc: 39.6, vmp: 33.2, temp_coeff_voc: -0.25 } },
  inverter: { specs: { ac_kw: 5, max_dc_kw: 8.5, mppt_count: 2, mppt_min_v: 120, max_input_v: 600 } },
  battery: { usableKwh: 9.5, count: 1 },
  postcode: "OX16 9AB",
  phases: 1,
  survey: { occupancy: "Home all day", annualUsageKwh: 4200 },
  tariff: { unitRatePence: 25, exportRatePence: 15 },
  hasEv: true,
  rules: {
    yields: [{ zone: "Z", pitch: 35, orientation: 0, kwhPerKwp: 854 }],
    zones: [{ postcodePrefix: "OX", zone: "Z" }],
    selfConsumption: [
      { occupancy: "Home all day", consumptionFromKwh: 0, generationFromKwh: 0, batteryFromKwh: 0, fraction: 0.38 },
      { occupancy: "Home all day", consumptionFromKwh: 0, generationFromKwh: 0, batteryFromKwh: 5, fraction: 0.71 },
    ],
    settings: { minDesignTempC: -10, evMilesPerKwh: 3.5 },
  },
};

describe("evaluateSolarDesign (synthetic tables)", () => {
  it("combines size, MCS generation, strings, G99, self-use, saving and EV miles", () => {
    const r = evaluateSolarDesign(base);
    expect(r).toMatchObject({
      panelCount: 18,
      kWp: 8.01,
      annualKwh: 6840, // floor(8.01 × 854)
      strings: [9, 9],
      dcAc: 1.6,
      exportKw: 5,
      connection: { form: "G99", thresholdKw: 3.68 },
      selfUse: 0.38,
      selfUseWithBattery: 0.71,
      yearlySavingPence: Math.round(6840 * (0.71 * 25 + 0.29 * 15)),
      evMiles: Math.round((6840 * 0.29 * 3.5) / 100) * 100,
      notes: [],
    });
    expect(r.perArray).toHaveLength(1);
  });

  it("lists what's missing instead of producing figures", () => {
    const r = evaluateSolarDesign({ ...base, inverter: null, rules: { yields: null, zones: null, selfConsumption: null, settings: {} } });
    expect(r.annualKwh).toBeNull();
    expect(r.notes).toEqual(expect.arrayContaining([expect.stringContaining("Upload the MCS"), "Choose an inverter."]));
  });
});
