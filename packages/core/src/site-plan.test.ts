import { describe, expect, it } from "vitest";
import { autoAssignStrings, cableLength, cableTotals, checkStrings, drawnStrings, fillArea, movePanel, panelsInArea, polylineLength, sldModel, type PanelRect } from "./site-plan";
import { evaluateSolarDesign } from "./solar-design";

const roof = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 5 },
  { x: 0, y: 5 },
];
const panel = { width: 1.1, height: 1.7 };
// Datasheet-style values for the tests (not rules).
const pv = { watts_peak: 445, voc: 40, vmp: 33, isc: 14, temp_coeff_voc: -0.25 };
const inv = { ac_kw: 5, mppt_count: 2, mppt_min_v: 120, mppt_max_v: 500, max_input_v: 600, max_input_a: 16 };

const arr = (id: string, panels: PanelRect[], over: Partial<{ pitch: number; azimuth: number }> = {}) => ({ id, label: `Roof ${id} · south`, pitch: 35, azimuth: 180, used: true, panels, ...over });
const n = (count: number, s?: number): PanelRect[] => Array.from({ length: count }, (_, i) => ({ x: i * 1.2, y: 0, w: 1.1, h: 1.7, s }));

describe("movePanel", () => {
  it("moves a panel when it still fits, snapped to 5 cm, and refuses otherwise", () => {
    const panels: PanelRect[] = [
      { x: 0.5, y: 0.5, w: 1.1, h: 1.7, s: 2 },
      { x: 2, y: 0.5, w: 1.1, h: 1.7 },
    ];
    expect(movePanel(roof, panels, 1, { dx: 3.03, dy: 1.01 }, { setback: 0.3 })).toEqual({ x: 5.05, y: 1.5, w: 1.1, h: 1.7 });
    expect(movePanel(roof, panels, 0, { dx: 0, dy: 0 }, { setback: 0.3 })).toMatchObject({ s: 2 }); // keeps its string
    expect(movePanel(roof, panels, 1, { dx: -1, dy: 0 }, { setback: 0.3 })).toBeNull(); // onto the other panel
    expect(movePanel(roof, panels, 1, { dx: 8, dy: 0 }, { setback: 0.3 })).toBeNull(); // off the roof
    expect(movePanel(roof, panels, 1, { dx: 2, dy: 0 }, { setback: 0.3, obstructions: [{ x: 4, y: 1, w: 0.8, h: 0.8 }] })).toBeNull();
  });
});

describe("fillArea", () => {
  it("lays a single row along a thin drag, starting where the drag began", () => {
    // Drag left to right along the roof, barely moving up or down.
    const row = fillArea(roof, { from: { x: 0.5, y: 2.4 }, to: { x: 9.5, y: 2.6 } }, panel, { setback: 0.3, gap: 0.02 });
    expect(row).toHaveLength(8);
    expect(new Set(row.map((p) => p.y)).size).toBe(1);
    expect(row[0]!.y).toBeCloseTo(2.4 - 1.7 / 2, 3);
    // Near the edge the row is nudged inside the setback rather than dropped.
    const edge = fillArea(roof, { from: { x: 0.5, y: 0.2 }, to: { x: 4, y: 0.25 } }, panel, { setback: 0.3, gap: 0.02 });
    expect(edge.length).toBeGreaterThan(0);
    expect(edge.every((p) => p.y >= 0.3)).toBe(true);
    // A thin drag up the slope lays a column.
    const col = fillArea(roof, { from: { x: 5, y: 0.4 }, to: { x: 5.1, y: 4.7 } }, panel, { setback: 0.3, gap: 0.02 });
    expect(col).toHaveLength(2);
    expect(new Set(col.map((p) => p.x)).size).toBe(1);
  });

  it("fills the dragged rectangle within the setback, from the start corner", () => {
    const placed = fillArea(roof, { from: { x: 0, y: 0 }, to: { x: 6, y: 4 } }, panel, { setback: 0.3, gap: 0.02 });
    // Every panel inside the roof and the setback, no overlaps.
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) expect(p.x >= 0.3 - 1e-9 && p.y >= 0.3 - 1e-9 && p.x + p.w <= 6 + 1e-9 && p.y + p.h <= 4 + 1e-9).toBe(true);
    // Clamped to the setback: a 1.12 × 1.72 m grid from (0.3, 0.3) fits 5 × 2.
    expect(Math.min(...placed.map((p) => p.x))).toBeCloseTo(0.3);
    expect(placed).toHaveLength(10);
  });

  it("skips obstructions and existing panels; a reverse drag grows from the far corner", () => {
    const existing = [{ x: 4, y: 1, w: 1.1, h: 1.7 }];
    const placed = fillArea(roof, { from: { x: 9.7, y: 4.7 }, to: { x: 1, y: 0.5 } }, panel, { setback: 0.3, existing, obstructions: [{ x: 7, y: 2.5, w: 0.8, h: 0.8 }] });
    expect(placed[0]).toMatchObject({ x: 8.6, y: 3 });
    for (const p of placed) {
      expect(p.x < 4 + 1.1 && p.x + p.w > 4 && p.y < 2.7 && p.y + p.h > 1).toBe(false);
      expect(p.x < 7.8 + 0.3 && p.x + p.w + 0.3 > 7 && p.y < 3.3 + 0.3 && p.y + p.h + 0.3 > 2.5).toBe(false);
    }
  });

  it("landscape swaps the panel's sides", () => {
    const placed = fillArea(roof, { from: { x: 0.3, y: 0.3 }, to: { x: 9.7, y: 4.7 } }, panel, { setback: 0.3, landscape: true, gap: 0 });
    expect(placed[0]).toMatchObject({ w: 1.7, h: 1.1 });
    expect(placed).toHaveLength(5 * 4);
  });
});

describe("panelsInArea", () => {
  it("picks panels whose centre is inside the box", () => {
    expect(panelsInArea(n(5), { from: { x: 0, y: 0 }, to: { x: 2.5, y: 2 } })).toEqual([0, 1]);
    expect(panelsInArea(n(5), { from: { x: 2.5, y: 2 }, to: { x: 0, y: 0 } })).toEqual([0, 1]);
  });
});

describe("lengths", () => {
  it("measures polylines and adds the extra to cables", () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
    expect(cableLength({ points: [{ x: 0, y: 0 }, { x: 3, y: 4 }], extraM: 2.34 })).toBe(7.3);
    expect(cableLength({ points: [{ x: 0, y: 0 }], extraM: -1 })).toBe(0);
    const totals = cableTotals([
      { id: "1", kind: "dc", points: [{ x: 0, y: 0 }, { x: 0, y: 5 }], extraM: 3, label: "" },
      { id: "2", kind: "dc", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], extraM: 0, label: "" },
      { id: "3", kind: "ev", points: [{ x: 0, y: 0 }, { x: 0, y: 12 }], extraM: 0, label: "" },
    ]);
    expect(totals).toEqual([
      { kind: "dc", lengthM: 12, runs: 2 },
      { kind: "ev", lengthM: 12, runs: 1 },
    ]);
  });
});

describe("drawnStrings", () => {
  it("is empty when nothing is wired", () => {
    expect(drawnStrings([arr("A", n(10))], null)).toEqual({ strings: [], unassigned: 0 });
  });
  it("counts panels per string, MPPT from the plan, and unwired panels", () => {
    const a = arr("A", [...n(8, 1), ...n(2)]);
    const b = arr("B", n(8, 2));
    const d = drawnStrings([a, b, { ...arr("C", n(3, 3)), used: false }], { strings: [{ mppt: 1 }, { mppt: 1 }] });
    expect(d).toEqual({
      strings: [
        { n: 1, panels: 8, mppt: 1, arrays: ["A"] },
        { n: 2, panels: 8, mppt: 1, arrays: ["B"] },
      ],
      unassigned: 2,
    });
  });
});

describe("checkStrings", () => {
  const settings = { minDesignTempC: -10 };
  // Voc cold = 40 × (1 + -0.0025 × -35) = 43.5 V → max 13 per string; min ceil(120/33) = 4.
  it("passes valid strings", () => {
    const a = arr("A", n(10, 1));
    const c = checkStrings(pv, inv, settings, drawnStrings([a], null), [a]);
    expect(c.ok).toBe(true);
    expect(c.strings[0]).toMatchObject({ n: 1, panels: 10, vocColdV: 435, vmpV: 330, issues: [] });
  });
  it("flags too many, too few, over MPPT max, a bad input and mixed faces", () => {
    const a = arr("A", [...n(14, 1), ...n(3, 2)]);
    const b = arr("B", n(2, 2), { azimuth: 90 });
    const c = checkStrings(pv, { ...inv, mppt_max_v: 400 }, settings, drawnStrings([a, b], { strings: [{ mppt: 1 }, { mppt: 3 }] }), [a, b]);
    expect(c.ok).toBe(false);
    expect(c.strings[0]!.issues.join(" ")).toMatch(/over the 13 maximum.*609 V.*600 V/);
    expect(c.strings[0]!.issues.join(" ")).toMatch(/462 V Vmp is above the MPPT range \(400 V\)/);
    expect(c.strings[1]!.issues.join(" ")).toMatch(/2 MPPT inputs/);
    expect(c.strings[1]!.issues.join(" ")).toMatch(/face different ways/);
  });
  it("checks parallel strings: matched counts and input current", () => {
    const a = arr("A", [...n(8, 1), ...n(7, 2)]);
    const c = checkStrings(pv, inv, settings, drawnStrings([a], { strings: [{ mppt: 1 }, { mppt: 1 }] }), [a]);
    expect(c.mppts[0]).toMatchObject({ mppt: 1, strings: [1, 2], iscA: 28 });
    expect(c.mppts[0]!.issues.join(" ")).toMatch(/different panel counts/);
    expect(c.mppts[0]!.issues.join(" ")).toMatch(/28 A.*16 A/);
  });
  it("says what's missing instead of guessing", () => {
    const a = arr("A", [...n(8, 1), ...n(8, 2)]);
    const c = checkStrings({ voc: 40, vmp: 33 }, { max_input_v: 600, mppt_min_v: 120 }, {}, drawnStrings([a], { strings: [{ mppt: 1 }, { mppt: 1 }] }), [a]);
    expect(c.notes).toEqual(expect.arrayContaining([expect.stringMatching(/uncorrected Voc/), expect.stringMatching(/number of MPPT inputs/), expect.stringMatching(/needs Isc/)]));
  });
});

describe("autoAssignStrings", () => {
  it("gives each roof its own input when it can", () => {
    const r = autoAssignStrings([arr("A", n(10)), arr("B", n(6), { azimuth: 270 })], pv, inv, { minDesignTempC: -10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arrays[0]!.panels.every((p) => p.s === 1)).toBe(true);
    expect(r.arrays[1]!.panels.every((p) => p.s === 2)).toBe(true);
    expect(r.plan).toEqual({ strings: [{ mppt: 1 }, { mppt: 2 }] });
  });
  it("splits evenly across roofs when there aren't enough inputs", () => {
    const r = autoAssignStrings([arr("A", n(10)), arr("B", n(6)), arr("C", n(4))], pv, inv, { minDesignTempC: -10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const counts = [1, 2].map((s) => r.arrays.flatMap((a) => a.panels).filter((p) => p.s === s).length);
    expect(counts).toEqual([10, 10]);
  });
  it("feeds evaluateSolarDesign, which reports wired counts and issues", () => {
    const r = autoAssignStrings([arr("A", n(10))], pv, inv, { minDesignTempC: -10 });
    if (!r.ok) throw new Error(r.missing);
    const panels = [...r.arrays[0]!.panels, { x: 0, y: 3, w: 1.1, h: 1.7, s: null }];
    const wired = drawnStrings([{ ...r.arrays[0]!, panels }], r.plan);
    const res = evaluateSolarDesign({
      arrays: [{ id: "A", label: "Roof A", pitch: 35, azimuth: 180, panelCount: 11, shadeFactor: 1 }],
      panel: { specs: pv },
      inverter: { specs: inv },
      battery: null,
      postcode: "",
      phases: 1,
      survey: { occupancy: null, annualUsageKwh: null },
      hasEv: false,
      wired,
      rules: { yields: null, zones: null, selfConsumption: null, settings: { minDesignTempC: -10 } },
    });
    expect(res.strings).toEqual([10]);
    expect(res.notes).toContain("1 panel isn't on a string yet.");
  });
});

describe("sldModel", () => {
  it("carries design values and lists unknown ratings as blanks", () => {
    const m = sldModel({
      panel: { name: "P445", specs: pv },
      inverter: { name: "H5", specs: { ...inv, hybrid: true } },
      battery: { name: "B10", usableKwh: 9.5, count: 1 },
      strings: [
        { n: 1, panels: 10, mppt: 1 },
        { n: 2, panels: 6, mppt: 2 },
      ],
      minDesignTempC: -10,
      supply: { phases: 1, mainFuseA: 100, earthing: "TN-C-S" },
      ev: { name: "Zappi", kw: 7.4, cableMm2: 6, lengthM: 12, protection: null },
      cables: [{ id: "1", kind: "dc", points: [{ x: 0, y: 0 }, { x: 0, y: 8 }], extraM: 2, label: "" }],
    });
    expect(m.strings[0]).toEqual({ n: 1, panels: 10, mppt: 1, kWp: 4.45, vocColdV: 435, iscA: 14 });
    expect(m.mppts).toEqual([1, 2]);
    expect(m.battery?.coupling).toBe("dc");
    expect(m.cableTotals).toEqual([{ kind: "dc", lengthM: 10, runs: 1 }]);
    expect(m.blanks).toContain("EV circuit protective device");
    expect(m.blanks).not.toContain("Main fuse rating");
    expect(m.blanks).not.toContain("EV cable size");
  });
});
