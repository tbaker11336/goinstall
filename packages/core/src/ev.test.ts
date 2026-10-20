import { describe, expect, it } from "vitest";
import { chargerCurrentA, evaluateEvDesign, maxDemand, parseAmps, routeLength, sizeCable, voltDropPercent, type CableRow } from "./ev";

// SYNTHETIC FIXTURE: invented ratings to test the selection logic. Not BS 7671
// values; the business supplies its own cable table.
const CABLES: CableRow[] = [
  { sizeMm2: 2.5, method: "clipped", ratingA: 27, mvPerAm: 18 },
  { sizeMm2: 4, method: "clipped", ratingA: 37, mvPerAm: 11 },
  { sizeMm2: 6, method: "clipped", ratingA: 47, mvPerAm: 7.3 },
  { sizeMm2: 10, method: "clipped", ratingA: 65, mvPerAm: 4.4 },
  { sizeMm2: 4, method: "buried", ratingA: 33, mvPerAm: 11 },
  { sizeMm2: 6, method: "buried", ratingA: 42, mvPerAm: 7.3 },
];

describe("cable route and volt drop", () => {
  it("measures a polyline", () => {
    expect(routeLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 11.4 }])).toBe(12.4);
  });

  it("works out percent volt drop", () => {
    expect(voltDropPercent(7.3, 32, 12.4)).toBe(1.3);
  });

  it("picks the smallest cable that carries the current and meets the limit", () => {
    expect(sizeCable([{ lengthM: 12.4, method: "clipped" }], 32, { cables: CABLES, voltDropLimitPct: 5 })).toEqual({ ok: true, sizeMm2: 4, voltDropPct: 1.9, withinLimit: true, lengthM: 12.4 });
    // A long run needs a bigger cable for volt drop, not current.
    expect(sizeCable([{ lengthM: 40, method: "clipped" }], 32, { cables: CABLES, voltDropLimitPct: 3 })).toMatchObject({ ok: true, sizeMm2: 10 });
  });

  it("checks every segment's method", () => {
    const route = [
      { lengthM: 5, method: "clipped" },
      { lengthM: 8, method: "buried" },
    ];
    expect(sizeCable(route, 35, { cables: CABLES, voltDropLimitPct: 5 })).toMatchObject({ ok: true, sizeMm2: 6, lengthM: 13 });
    expect(sizeCable([{ lengthM: 5, method: "in conduit" }], 32, { cables: CABLES, voltDropLimitPct: 5 })).toEqual({ ok: false, missing: "The cable table has no rows for: in conduit." });
  });

  it("reports missing rules instead of guessing", () => {
    expect(sizeCable([{ lengthM: 5, method: "clipped" }], 32, { cables: null, voltDropLimitPct: 5 })).toMatchObject({ ok: false });
    expect(sizeCable([{ lengthM: 5, method: "clipped" }], 32, { cables: CABLES, voltDropLimitPct: null })).toMatchObject({ ok: false });
    expect(sizeCable([{ lengthM: 500, method: "clipped" }], 32, { cables: CABLES, voltDropLimitPct: 5 })).toMatchObject({ ok: false, missing: expect.stringContaining("No cable") });
  });
});

describe("maximum demand", () => {
  it("adds the charger at the business's diversity and flags load management", () => {
    expect(maxDemand({ existingDemandA: 46, chargerA: 32, mainFuseA: 100 }, { chargerDiversity: 1 })).toEqual({
      ok: true,
      demandA: 78,
      mainFuseA: 100,
      headroomA: 22,
      loadManagementNeeded: false,
      fuseUpgradeWarning: false,
    });
    expect(maxDemand({ existingDemandA: 40, chargerA: 32, mainFuseA: 60 }, { chargerDiversity: 1 })).toMatchObject({ loadManagementNeeded: true, fuseUpgradeWarning: true });
  });
  it("needs the fuse, existing demand and diversity", () => {
    expect(maxDemand({ existingDemandA: 40, chargerA: 32, mainFuseA: null }, { chargerDiversity: 1 })).toMatchObject({ ok: false });
    expect(maxDemand({ existingDemandA: 40, chargerA: 32, mainFuseA: 100 }, { chargerDiversity: null })).toMatchObject({ ok: false });
  });
});

describe("helpers", () => {
  it("reads amps from survey answers", () => {
    expect(parseAmps("100 A")).toBe(100);
    expect(parseAmps("80A")).toBe(80);
    expect(parseAmps("Not sure")).toBeNull();
  });
  it("derives charger current from the datasheet", () => {
    expect(chargerCurrentA({ rated_a: 32 })).toBe(32);
    expect(chargerCurrentA({ rated_kw: 7.4 })).toBe(32.2);
    expect(chargerCurrentA({ rated_kw: 22, phases: 3 })).toBe(31.9);
    expect(chargerCurrentA({})).toBeNull();
  });
});

describe("evaluateEvDesign (synthetic table)", () => {
  const rules = { cables: CABLES, voltDropLimitPct: 5, chargerDiversity: 1 };
  it("sizes cable over a drawn route with per-segment methods and checks demand", () => {
    const r = evaluateEvDesign({
      route: [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 10.4, y: 2 }],
      routeMethods: ["clipped", "clipped"],
      routeLengthM: null,
      routeLengthMeasured: true,
      charger: { rated_a: 32 },
      mainFuseA: 100,
      existingDemandA: 46,
      rules,
    });
    expect(r).toMatchObject({ lengthM: 12.4, chargerA: 32, cableSizeMm2: 4, voltDropPct: 1.9, demandA: 78, loadManagementNeeded: false, notes: [] });
  });
  it("uses a typed length when the plan isn't to scale", () => {
    const r = evaluateEvDesign({ route: [], routeMethods: ["buried"], routeLengthM: 8, routeLengthMeasured: false, charger: { rated_a: 32 }, mainFuseA: 60, existingDemandA: 40, rules });
    // 4 mm² buried is rated 33 A in the fixture, enough for 32 A.
    expect(r).toMatchObject({ lengthM: 8, cableSizeMm2: 4, loadManagementNeeded: true, fuseUpgradeWarning: true });
  });
  it("lists what's missing", () => {
    const r = evaluateEvDesign({ route: [], routeMethods: [], routeLengthM: null, routeLengthMeasured: true, charger: null, mainFuseA: null, existingDemandA: null, rules: { cables: null, voltDropLimitPct: null, chargerDiversity: null } });
    expect(r.notes).toEqual(["Choose a charger.", "Draw the cable route from the supply to the charger."]);
  });
});
