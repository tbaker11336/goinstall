import { describe, expect, it } from "vitest";
import { checklistProgress, missingForStep, parseReadings, stepsForJob, type ChecklistStep } from "./checklist";

const step = (p: Partial<ChecklistStep>): ChecklistStep => ({ id: "s", kind: "install", product: "general", title: "T", help: null, position: 0, requiresPhoto: false, requiresSerial: false, readings: [], ...p });

describe("checklists", () => {
  it("parses reading labels and units", () => {
    expect(parseReadings("Insulation resistance (MΩ)\n\nZs (Ω)\nZs (Ω)\nNotes")).toEqual([
      { key: "insulation_resistance", label: "Insulation resistance", unit: "MΩ" },
      { key: "zs", label: "Zs", unit: "Ω" },
      { key: "zs_2", label: "Zs", unit: "Ω" },
      { key: "notes", label: "Notes", unit: null },
    ]);
  });

  it("picks steps for the job's products", () => {
    const steps = [step({ id: "a", product: "ev", position: 2 }), step({ id: "b", product: "general", position: 1 }), step({ id: "c", product: "battery" }), step({ id: "d", kind: "handover" })];
    expect(stepsForJob(steps, ["solar", "ev"], "install").map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("needs the photo, serial and every reading", () => {
    const s = step({ requiresPhoto: true, requiresSerial: true, readings: [{ key: "zs", label: "Zs", unit: "Ω" }] });
    expect(missingForStep(s, { done: true, photoCount: 0, serial: " ", readings: {} })).toEqual(["photo", "serial number", "Zs"]);
    expect(missingForStep(s, { done: true, photoCount: 1, serial: "SN1", readings: { zs: "0.35" } })).toEqual([]);
    expect(checklistProgress([s], { s: { done: true, photoCount: 1, serial: "SN1", readings: { zs: "0.35" } } })).toEqual({ done: 1, total: 1 });
  });
});
