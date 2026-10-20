import { describe, expect, it } from "vitest";
import { parseCsv } from "./catalogue";
import { parseCableTable, parseDesignSettings, parseSelfConsumptionTable, parseYieldTable, parseZoneTable } from "./rules";

// All values below are made up to test parsing; they are not MCS or BS 7671 data.

describe("MCS yield table", () => {
  it("reads the long layout", () => {
    expect(parseYieldTable(parseCsv("Zone,Pitch,Orientation,kWh per kWp\nZ1,30,0,1000\nZ1,30,5,998"))).toEqual({
      rows: [
        { zone: "Z1", pitch: 30, orientation: 0, kwhPerKwp: 1000 },
        { zone: "Z1", pitch: 30, orientation: 5, kwhPerKwp: 998 },
      ],
    });
  });
  it("reads the grid layout with orientation columns", () => {
    const r = parseYieldTable(parseCsv("zone,pitch,0,45,90\nZ1,30,1000,950,800\nZ1,40,990,930,770"));
    expect("rows" in r && r.rows).toHaveLength(6);
    expect("rows" in r && r.rows[4]).toEqual({ zone: "Z1", pitch: 40, orientation: 45, kwhPerKwp: 930 });
  });
  it("reports bad values with the line", () => {
    expect(parseYieldTable(parseCsv("zone,pitch,0\nZ1,30,abc"))).toEqual({ error: 'Line 2: value for 0° "abc" isn\'t a number.' });
    expect(parseYieldTable(parseCsv("zone,angle\nZ1,30"))).toMatchObject({ error: expect.stringContaining('Missing column "pitch"') });
  });
});

describe("other tables", () => {
  it("reads postcode zones", () => {
    expect(parseZoneTable(parseCsv("Postcode,Zone\nox16,Z2\nOX,Z1"))).toEqual({ rows: [{ postcodePrefix: "OX16", zone: "Z2" }, { postcodePrefix: "OX", zone: "Z1" }] });
    expect(parseZoneTable(parseCsv("postcode,zone\nOX16 9AB,Z2"))).toMatchObject({ error: expect.stringContaining("isn't a postcode area") });
  });
  it("reads self-consumption bands and checks fractions", () => {
    expect(parseSelfConsumptionTable(parseCsv("occupancy,consumption_from_kwh,generation_from_kwh,battery_from_kwh,fraction\nHome all day,0,0,0,0.5"))).toEqual({
      rows: [{ occupancy: "Home all day", consumptionFromKwh: 0, generationFromKwh: 0, batteryFromKwh: 0, fraction: 0.5 }],
    });
    expect(parseSelfConsumptionTable(parseCsv("occupancy,consumption_from_kwh,generation_from_kwh,battery_from_kwh,fraction\nX,0,0,0,50"))).toMatchObject({ error: expect.stringContaining("between 0 and 1") });
  });
  it("reads cable rows", () => {
    // Friendly headers are normalised to the column names.
    expect(parseCableTable(parseCsv("Size (mm2),Method,Rating A,mV per Am\n6,clipped,47,7.3"))).toEqual({ rows: [{ sizeMm2: 6, method: "clipped", ratingA: 47, mvPerAm: 7.3 }] });
    expect(parseCableTable(parseCsv("size,method,rating_a,mv_per_am\n6,clipped,47,7.3"))).toMatchObject({ error: expect.stringContaining('Missing column "size_mm2"') });
    expect(parseCableTable(parseCsv("size_mm2,method,rating_a,mv_per_am\n6,clipped,47,7.3"))).toEqual({ rows: [{ sizeMm2: 6, method: "clipped", ratingA: 47, mvPerAm: 7.3 }] });
  });
});

describe("design settings", () => {
  it("keeps numbers in range and drops blanks", () => {
    expect(parseDesignSettings({ edgeSetbackM: "0.4", minDesignTempC: "", evVoltDropLimitPct: "5" })).toEqual({ settings: { edgeSetbackM: 0.4, evVoltDropLimitPct: 5 } });
    expect(parseDesignSettings({ evChargerDiversity: "2" })).toMatchObject({ error: expect.stringContaining("0 to 1") });
  });
});
