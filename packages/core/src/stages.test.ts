import { describe, expect, it } from "vitest";
import {
  canMarkLost,
  contactStageFromProjects,
  nextStage,
  PROJECT_STAGES,
  validateStageChange,
} from "./stages";

describe("canMarkLost", () => {
  it("allows lost only before the deposit is paid", () => {
    const allowed = PROJECT_STAGES.filter(canMarkLost);
    expect(allowed).toEqual(["enquiry", "survey", "design", "proposal_sent", "accepted"]);
    expect(canMarkLost("lost")).toBe(false);
  });
});

describe("nextStage", () => {
  it("walks the workflow in order and stops at complete", () => {
    expect(nextStage("enquiry")).toBe("survey");
    expect(nextStage("accepted")).toBe("deposit_paid");
    expect(nextStage("complete")).toBeNull();
    expect(nextStage("lost")).toBeNull();
  });
});

describe("validateStageChange", () => {
  it("rejects a no-op", () => {
    expect(validateStageChange("survey", "survey").ok).toBe(false);
  });

  it("allows moving back without a warning", () => {
    expect(validateStageChange("design", "survey")).toEqual({ ok: true });
  });

  it("warns when moving forward by hand", () => {
    const r = validateStageChange("accepted", "deposit_paid");
    expect(r.ok).toBe(true);
    expect(r.ok && r.warning).toMatch(/stripe/i);
  });

  it("mentions skipped stages", () => {
    const r = validateStageChange("enquiry", "proposal_sent");
    expect(r.ok && r.warning).toMatch(/skips 2 stages/);
  });

  it("needs a reason to mark lost", () => {
    expect(validateStageChange("survey", "lost", { lostReason: "  " }).ok).toBe(false);
    expect(validateStageChange("survey", "lost", { lostReason: "Too expensive" })).toEqual({ ok: true });
  });

  it("refuses lost after the deposit", () => {
    const r = validateStageChange("kit_ordered", "lost", { lostReason: "Cancelled" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/deposit/) });
  });

  it("allows reopening a lost project", () => {
    expect(validateStageChange("lost", "proposal_sent")).toEqual({ ok: true });
  });
});

describe("contactStageFromProjects", () => {
  it("uses the furthest open project", () => {
    expect(contactStageFromProjects(["survey", "lost", "design"])).toBe("design");
    expect(contactStageFromProjects(["accepted"])).toBe("proposal_sent");
    expect(contactStageFromProjects(["enquiry", "scheduled"])).toBe("won");
  });

  it("is lost only when every project is lost", () => {
    expect(contactStageFromProjects(["lost", "lost"])).toBe("lost");
    expect(contactStageFromProjects(["lost", "enquiry"])).toBe("new_enquiry");
  });

  it("returns null with no projects", () => {
    expect(contactStageFromProjects([])).toBeNull();
  });
});
