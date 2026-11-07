import { describe, expect, it } from "vitest";
import { proposalSurvey, shownSurvey } from "./proposal-survey";
import type { SurveyQuestion } from "./survey";

const q = (key: string, label: string, section: string): SurveyQuestion => ({ key, label, section, help: null, type: "text", options: [], products: [], position: 0, required: false, askOnline: true });

describe("proposalSurvey", () => {
  const solar = { kind: "solar_battery" as const, questions: [q("roof", "Roof type", "Roof"), q("shade", "Shading", "Roof"), q("fuse", "Main fuse", "Electrics"), q("loft", "Loft access", "Access")], values: { roof: "Tiled", shade: "", fuse: "100 A" } };

  it("groups answered questions by section with the staff notes beside them", () => {
    const out = proposalSurvey([solar], { "solar_battery:Electrics": { note: "  The fuse is fine for the inverter.  " } });
    expect(out).toEqual([
      { key: "solar_battery:Roof", title: "Roof", items: [{ label: "Roof type", value: "Tiled" }], note: null, hidden: false },
      { key: "solar_battery:Electrics", title: "Electrics", items: [{ label: "Main fuse", value: "100 A" }], note: "The fuse is fine for the inverter.", hidden: false },
    ]);
  });

  it("keeps a section with only a note, names the survey when there are two, and hides on request", () => {
    const ev = { kind: "ev" as const, questions: [q("park", "Parking", "Driveway")], values: { park: "Off-street" } };
    const out = proposalSurvey([solar, ev], { "solar_battery:Access": { note: "Ladder access only" }, "ev:Driveway": { hidden: true } });
    expect(out.map((s) => s.title)).toEqual(["Solar & battery · Roof", "Solar & battery · Electrics", "Solar & battery · Access", "EV charger · Driveway"]);
    expect(shownSurvey(out).map((s) => s.key)).not.toContain("ev:Driveway");
  });
});
