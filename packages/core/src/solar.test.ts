import { describe, expect, it } from "vitest";
import {
  autoFill,
  connectionApplication,
  dcAcRatio,
  exportCapacityKw,
  kWp,
  layoutStrings,
  lookupKwhPerKwp,
  matchInverter,
  mcsAnnualGeneration,
  orientationFromAzimuth,
  rectFits,
  selfConsumption,
  stringLimits,
  zoneForPostcode,
  type McsYieldRow,
} from "./solar";

// SYNTHETIC FIXTURES: made-up numbers to test the lookup logic. They are not
// MCS values. Real tables and worked examples come from the business.
const YIELDS: McsYieldRow[] = [
  { zone: "Z1", pitch: 30, orientation: 0, kwhPerKwp: 1000 },
  { zone: "Z1", pitch: 30, orientation: 45, kwhPerKwp: 950 },
  { zone: "Z1", pitch: 30, orientation: 90, kwhPerKwp: 800 },
  { zone: "Z1", pitch: 40, orientation: 0, kwhPerKwp: 990 },
  { zone: "Z1", pitch: 40, orientation: 45, kwhPerKwp: 930 },
  { zone: "Z2", pitch: 30, orientation: 0, kwhPerKwp: 900 },
];
const ZONES = [
  { postcodePrefix: "OX", zone: "Z1" },
  { postcodePrefix: "OX16", zone: "Z2" },
];

describe("MCS lookup (synthetic tables)", () => {
  it("converts azimuth to degrees off south", () => {
    expect(orientationFromAzimuth(180)).toBe(0);
    expect(orientationFromAzimuth(135)).toBe(45);
    expect(orientationFromAzimuth(225)).toBe(45);
    expect(orientationFromAzimuth(0)).toBe(180);
    expect(orientationFromAzimuth(-90)).toBe(90);
  });

  it("finds the zone by outward code, then by area", () => {
    expect(zoneForPostcode("ox16 9ab", ZONES)).toBe("Z2");
    expect(zoneForPostcode("OX5 1AA", ZONES)).toBe("Z1");
    expect(zoneForPostcode("BS1 4DJ", ZONES)).toBeNull();
  });

  it("uses the nearest pitch and orientation in the table", () => {
    expect(lookupKwhPerKwp(YIELDS, "Z1", 36, 50)).toEqual({ ok: true, kwhPerKwp: 930, pitch: 40, orientation: 45 });
    expect(lookupKwhPerKwp(YIELDS, "Z9", 30, 0)).toMatchObject({ ok: false });
  });

  it("multiplies kWp, kWh/kWp and shade factor per array and floors each array", () => {
    const r = mcsAnnualGeneration(
      [
        { id: "A", panelCount: 18, pitch: 35, azimuth: 180, shadeFactor: 1 },
        { id: "B", panelCount: 4, pitch: 30, azimuth: 270, shadeFactor: 0.9 },
      ],
      445,
      "OX5 1AA",
      { yields: YIELDS, zones: ZONES },
    );
    // A: 8.01 kWp; 35° is equidistant from 30° and 40°, so the first (30°) row is used: 8.01 × 1000 = 8010.
    // B: 1.78 kWp × 800 × 0.9 = 1281.6 -> 1281.
    expect(r).toMatchObject({ ok: true, zone: "Z1", annualKwh: 8010 + 1281, kWp: 9.79 });
  });

  it("says what is missing rather than guessing", () => {
    expect(mcsAnnualGeneration([{ id: "A", panelCount: 1, pitch: 30, azimuth: 180, shadeFactor: 1 }], 445, "OX5", null)).toMatchObject({ ok: false, missing: expect.stringContaining("Upload the MCS") });
    expect(mcsAnnualGeneration([{ id: "A", panelCount: 1, pitch: 30, azimuth: 180, shadeFactor: 1.2 }], 445, "OX5", { yields: YIELDS, zones: ZONES })).toMatchObject({ ok: false });
  });
});

describe("inverters and strings", () => {
  const inverters = [
    { id: "3.6", specs: { ac_kw: 3.6, max_dc_kw: 5.4 } },
    { id: "5", specs: { ac_kw: 5, max_dc_kw: 8 } },
    { id: "5H", specs: { ac_kw: 5, max_dc_kw: 8, hybrid: true } },
    { id: "8", specs: { ac_kw: 8, max_dc_kw: 12 } },
  ];
  it("sizes kWp and DC/AC", () => {
    expect(kWp(18, 445)).toBe(8.01);
    expect(dcAcRatio(8.01, 5)).toBe(1.6);
  });
  it("matches the smallest inverter that takes the array, hybrid with a battery", () => {
    expect(matchInverter(inverters, 8.01)?.id).toBe("8");
    expect(matchInverter(inverters, 7.5)?.id).toBe("5");
    expect(matchInverter(inverters, 7.5, { battery: true })?.id).toBe("5H");
    expect(matchInverter(inverters, 20)).toBeNull();
  });
  it("limits panels per string from datasheet voltages", () => {
    const panel = { voc: 39.6, vmp: 33.2, temp_coeff_voc: -0.25 };
    const inverter = { max_input_v: 600, mppt_min_v: 120 };
    expect(stringLimits(panel, inverter, {})).toEqual({ ok: true, minPerString: 4, maxPerString: 15, vocCorrected: false });
    // A cold design temperature (company setting) raises Voc, so fewer panels fit.
    expect(stringLimits(panel, inverter, { minDesignTempC: -10 })).toEqual({ ok: true, minPerString: 4, maxPerString: 13, vocCorrected: true });
  });
  it("splits panels across MPPT inputs", () => {
    expect(layoutStrings(18, { minPerString: 4, maxPerString: 13 }, 2)).toEqual({ ok: true, strings: [9, 9] });
    expect(layoutStrings(11, { minPerString: 4, maxPerString: 13 }, 2)).toEqual({ ok: true, strings: [11] });
    expect(layoutStrings(30, { minPerString: 4, maxPerString: 13 }, 2)).toMatchObject({ ok: false });
  });
});

describe("G98 / G99", () => {
  it("compares export capacity with the per-phase limit", () => {
    expect(connectionApplication(3.6, 1)).toEqual({ form: "G98", thresholdKw: 3.68 });
    expect(connectionApplication(5, 1)).toEqual({ form: "G99", thresholdKw: 3.68 });
    expect(connectionApplication(10, 3)).toEqual({ form: "G98", thresholdKw: 11.04 });
  });
  it("applies an export limit", () => {
    expect(exportCapacityKw([{ acKw: 5 }, { acKw: 5 }])).toBe(10);
    expect(exportCapacityKw([{ acKw: 5 }], 3.68)).toBe(3.68);
  });
});

describe("self-consumption bands (synthetic table)", () => {
  const rows = [
    { occupancy: "Home all day", consumptionFromKwh: 0, generationFromKwh: 0, batteryFromKwh: 0, fraction: 0.5 },
    { occupancy: "Home all day", consumptionFromKwh: 3000, generationFromKwh: 0, batteryFromKwh: 0, fraction: 0.45 },
    { occupancy: "Home all day", consumptionFromKwh: 3000, generationFromKwh: 0, batteryFromKwh: 5, fraction: 0.8 },
  ];
  it("picks the band each value falls in", () => {
    expect(selfConsumption(rows, { occupancy: "home all day", consumptionKwh: 4200, generationKwh: 6800, batteryKwh: 0 })).toEqual({ ok: true, fraction: 0.45 });
    expect(selfConsumption(rows, { occupancy: "Home all day", consumptionKwh: 4200, generationKwh: 6800, batteryKwh: 9.5 })).toEqual({ ok: true, fraction: 0.8 });
    expect(selfConsumption(null, { occupancy: "x", consumptionKwh: 1, generationKwh: 1, batteryKwh: 0 })).toMatchObject({ ok: false });
  });
});

describe("panel layout", () => {
  const roof = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
    { x: 0, y: 5 },
  ];
  it("keeps the edge setback", () => {
    expect(rectFits({ x: 0.4, y: 0.4, w: 1, h: 1.7 }, roof, 0.4)).toBe(true);
    expect(rectFits({ x: 0.3, y: 0.4, w: 1, h: 1.7 }, roof, 0.4)).toBe(false);
  });
  it("fills rows within setbacks and around obstructions", () => {
    const panel = { width: 1.134, height: 1.762 };
    const open = autoFill(roof, panel, { setback: 0.4 });
    // 9.2 m usable width: 8 portrait panels need 8 × 1.134 + 7 × 0.02 = 9.21 m, so 7 fit; 4.2 m height fits 2 rows.
    expect(open).toHaveLength(14);
    const withChimney = autoFill(roof, panel, { setback: 0.4, obstructions: [{ x: 4.5, y: 0.5, w: 0.8, h: 0.8 }] });
    expect(withChimney.length).toBeLessThan(14);
    expect(withChimney.every((p) => !(p.x < 4.5 + 0.8 + 0.4 && p.x + p.w + 0.4 > 4.5 && p.y < 0.5 + 0.8 + 0.4 && p.y + p.h + 0.4 > 0.5))).toBe(true);
  });
});
