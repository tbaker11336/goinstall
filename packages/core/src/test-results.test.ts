import { describe, expect, it } from "vitest";
import { boardTitle, circuitGroups, circuitWarnings, cleanTestBoard, CIRCUIT_FIELDS } from "./test-results";

describe("test results", () => {
  it("keeps known fields as trimmed text and drops empty circuit rows", () => {
    const b = cleanTestBoard({ board: { db_ref: " DB1 ", zdb: 0.35, junk: "x" }, circuits: [{ ref: "1", designation: "Sockets", ir_pe: ">200" }, { ref: "  " }, null] });
    expect(b).toEqual({ board: { db_ref: "DB1", zdb: "0.35" }, circuits: [{ ref: "1", designation: "Sockets", ir_pe: ">200" }] });
  });

  it("flags a measured Zs above the permitted Zs written for the circuit, and a polarity cross", () => {
    expect(circuitWarnings({ ref: "1", max_zs: "1.37", zs: "1.52", polarity: "✗" })).toEqual(["Measured Zs 1.52 Ω is above the permitted 1.37 Ω", "Polarity marked incorrect"]);
    expect(circuitWarnings({ ref: "1", max_zs: "1.37", zs: "0.62", polarity: "✓" })).toEqual([]);
    // ">200" and "N/A" aren't compared.
    expect(circuitWarnings({ ref: "1", max_zs: "N/A", zs: "0.6" })).toEqual([]);
    expect(circuitWarnings({ ref: "2", designation: "Lights" })).toEqual(["No test results yet"]);
  });

  it("names boards and groups the columns like the sheet", () => {
    expect(boardTitle({ db_ref: "DB1", location: "Garage" }, 0)).toBe("DB1 · Garage");
    expect(boardTitle({}, 1)).toBe("Board 2");
    const groups = circuitGroups();
    expect(groups.map((g) => g.group)).toEqual(["Circuit details", "Overcurrent device", "Ring final circuits", "All circuits (one column at least)", "Insulation resistance", "Polarity and Zs", "RCD"]);
    expect(groups.flatMap((g) => g.fields)).toHaveLength(CIRCUIT_FIELDS.length);
  });
});

describe("the installer app's copy of the fields", () => {
  it("matches core", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync(new URL("../../../apps/installer/src/test-fields.ts", import.meta.url), "utf8");
    const { BOARD_FIELDS } = await import("./test-results");
    for (const f of [...BOARD_FIELDS, ...CIRCUIT_FIELDS]) expect(app).toContain(JSON.stringify(f.label));
    const keys = [...app.matchAll(/key: "([a-z0-9_]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual([...BOARD_FIELDS, ...CIRCUIT_FIELDS].map((f) => f.key));
  });
});
