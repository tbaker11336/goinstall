import { describe, expect, it } from "vitest";
import {
  appliesTo,
  firstName,
  groupBySection,
  normaliseAnswer,
  photoCategoriesFor,
  questionsFor,
  renderTemplate,
  surveyProgress,
  templatePlaceholders,
  type PhotoCategory,
  type SurveyQuestion,
} from "./survey";

const q = (key: string, products: SurveyQuestion["products"], extra: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  key,
  label: key,
  help: null,
  type: "text",
  options: [],
  products,
  section: "S",
  position: 0,
  required: false,
  askOnline: true,
  ...extra,
});

const QUESTIONS = [
  q("charger_location", ["ev"], { position: 30, required: true, section: "Car charger" }),
  q("roof_type", ["solar"], { position: 10, required: true, section: "Your roof" }),
  q("inverter_location", ["solar", "battery"], { position: 20, section: "Equipment" }),
  q("supply_phase", [], { position: 40, section: "Your electrics" }),
  q("earthing", [], { position: 50, askOnline: false, section: "Your electrics" }),
];

describe("appliesTo", () => {
  it("applies unscoped items to every project", () => expect(appliesTo([], ["ev"])).toBe(true));
  it("matches any shared product", () => expect(appliesTo(["solar", "battery"], ["battery"])).toBe(true));
  it("excludes other products", () => expect(appliesTo(["solar"], ["ev"])).toBe(false));
  it("includes everything when the project has no products yet", () => expect(appliesTo(["ev"], [])).toBe(true));
});

describe("questionsFor", () => {
  it("gives an EV-only project the EV and shared questions", () => {
    expect(questionsFor(QUESTIONS, ["ev"]).map((x) => x.key)).toEqual(["charger_location", "supply_phase", "earthing"]);
  });
  it("gives a solar and battery project its questions in position order", () => {
    expect(questionsFor(QUESTIONS, ["solar", "battery"]).map((x) => x.key)).toEqual(["roof_type", "inverter_location", "supply_phase", "earthing"]);
  });
  it("leaves staff-only questions off the online form", () => {
    expect(questionsFor(QUESTIONS, ["ev"], { online: true }).map((x) => x.key)).toEqual(["charger_location", "supply_phase"]);
  });
  it("groups by section in order", () => {
    expect(groupBySection(questionsFor(QUESTIONS, ["solar"])).map((g) => [g.section, g.questions.length])).toEqual([
      ["Your roof", 1],
      ["Equipment", 1],
      ["Your electrics", 2],
    ]);
  });
});

const CATEGORIES: PhotoCategory[] = [
  { key: "front", label: "Front", help: null, products: [], required: true, position: 1 },
  { key: "roof", label: "Roof", help: null, products: ["solar"], required: true, position: 2 },
  { key: "loft", label: "Loft", help: null, products: ["solar"], required: false, position: 3 },
  { key: "charger_spot", label: "Charger", help: null, products: ["ev"], required: true, position: 4 },
];

describe("surveyProgress", () => {
  it("counts answers and lists missing required questions and photos", () => {
    const questions = questionsFor(QUESTIONS, ["solar"]);
    const p = surveyProgress(
      questions,
      [
        { key: "inverter_location", value: "Garage", source: "online" },
        { key: "supply_phase", value: "  ", source: "online" },
      ],
      photoCategoriesFor(CATEGORIES, ["solar"]),
      { front: 2, loft: 1 },
    );
    expect(p).toEqual({ answered: 1, total: 4, missingRequired: ["roof_type"], photosTaken: 2, photosRequired: 2, missingPhotos: ["roof"] });
  });
});

describe("normaliseAnswer", () => {
  it("clears blank answers", () => expect(normaliseAnswer({ type: "text", options: [], label: "X" }, "  ")).toEqual({ value: null }));
  it("parses numbers with thousands separators", () => expect(normaliseAnswer({ type: "number", options: [], label: "Usage" }, "4,200")).toEqual({ value: "4200" }));
  it("rejects negative or non-numbers", () => {
    expect(normaliseAnswer({ type: "number", options: [], label: "Usage" }, "-3")).toEqual({ error: "Usage: enter a number" });
    expect(normaliseAnswer({ type: "number", options: [], label: "Usage" }, "lots")).toHaveProperty("error");
  });
  it("only accepts listed options", () => {
    expect(normaliseAnswer({ type: "select", options: ["A", "B"], label: "Pick" }, "B")).toEqual({ value: "B" });
    expect(normaliseAnswer({ type: "select", options: ["A", "B"], label: "Pick" }, "C")).toHaveProperty("error");
  });
  it("only accepts Yes or No", () => expect(normaliseAnswer({ type: "yes_no", options: [], label: "Parking" }, "maybe")).toHaveProperty("error"));
});

describe("templates", () => {
  it("fills placeholders and drops unknown ones", () => {
    expect(renderTemplate("Hi {{ first_name }},\n\n{{missing}}\n\n\nLink: {{survey_link}}", { first_name: "Sarah", survey_link: "https://x/s/abc" })).toBe(
      "Hi Sarah,\n\nLink: https://x/s/abc",
    );
  });
  it("lists placeholders once each", () => expect(templatePlaceholders("{{a_b}} {{c}} {{a_b}}")).toEqual(["a_b", "c"]));
  it("picks a friendly first name", () => {
    expect(firstName("Sarah Mitchell")).toBe("Sarah");
    expect(firstName("Martin & Jo Fielding")).toBe("Martin & Jo");
    expect(firstName("Cher")).toBe("Cher");
  });
});

describe("survey kinds", () => {
  it("gives a project one survey per kind it needs", async () => {
    const { surveyKindsFor } = await import("./survey");
    expect(surveyKindsFor(["solar", "battery", "ev"])).toEqual(["solar_battery", "ev"]);
    expect(surveyKindsFor(["ev"])).toEqual(["ev"]);
    expect(surveyKindsFor(["battery"])).toEqual(["solar_battery"]);
    expect(surveyKindsFor([])).toEqual(["solar_battery"]);
  });
});
