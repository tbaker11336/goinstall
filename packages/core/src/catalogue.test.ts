import { describe, expect, it } from "vitest";
import { bestOffer, formatPence, guessCategory, guessMapping, mapImportRows, margin, parseCsv, parsePence, parseSpecs } from "./catalogue";

describe("money", () => {
  it("parses prices to pence", () => {
    expect(parsePence("£1,234.50")).toBe(123450);
    expect(parsePence("96")).toBe(9600);
    expect(parsePence("0.5")).toBe(50);
    expect(parsePence(" ")).toBeNull();
    expect(parsePence("12.345")).toBeNaN();
    expect(parsePence("ninety")).toBeNaN();
  });
  it("formats pence", () => {
    expect(formatPence(371250)).toBe("£3,712.50");
    expect(formatPence(9600)).toBe("£96");
    expect(formatPence(null)).toBe("—");
  });
  it("works out margin", () => expect(margin(16500, 9600)).toBeCloseTo(0.418, 3));
});

describe("parseCsv", () => {
  it("handles quotes, embedded commas and CRLF", () => {
    expect(parseCsv('Name,Price\r\n"Panel, black ""445""",£96\r\nRail,12\r\n\r\n')).toEqual([
      ["Name", "Price"],
      ['Panel, black "445"', "£96"],
      ["Rail", "12"],
    ]);
  });
  it("detects semicolon and tab separators", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("strips a byte order mark", () => expect(parseCsv("﻿SKU,Cost\nX1,5")[0]).toEqual(["SKU", "Cost"]));
});

describe("import mapping", () => {
  const csv = parseCsv(
    [
      "Stock Code,Description,Brand,Model,Trade Price (ex VAT),Free Stock,Lead Time,Wp",
      "PNL-445,445 W all-black panel,Aiko,AIK-445,96.00,120,,445",
      "INV-5H,5 kW hybrid inverter,SolarEdge,SE5K,£890,0,3,",
      "BAD-1,Mystery,,M1,lots,,,",
      ",,,,,,,",
    ].join("\n"),
  );

  it("guesses the mapping from common supplier headers", () => {
    expect(guessMapping(csv[0]!)).toEqual({ supplier_sku: 0, name: 1, make: 2, model: 3, cost: 4, stock: 5, lead_time_days: 6, watts_peak: 7 });
  });

  it("maps rows, guesses categories and reports bad rows by line", () => {
    const { rows, errors } = mapImportRows(csv.slice(1), guessMapping(csv[0]!));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line: 2, name: "445 W all-black panel", make: "Aiko", model: "AIK-445", category: "panel", supplierSku: "PNL-445", costPence: 9600, stockQty: 120, specs: { watts_peak: 445 } });
    expect(rows[1]).toMatchObject({ category: "inverter", costPence: 89000, stockQty: 0, leadTimeDays: 3 });
    expect(errors).toEqual([{ line: 4, message: 'Cost "lots" isn\'t a price' }]);
  });

  it("falls back to the supplier code when there is no model column", () => {
    const { rows } = mapImportRows([["X-9", "Cable 6mm SWA"]], { supplier_sku: 0, name: 1 });
    expect(rows[0]).toMatchObject({ model: "X-9", category: "cable" });
  });
});

describe("categories and specs", () => {
  it("recognises category names and keywords", () => {
    expect(guessCategory("EV charger")).toBe("ev_charger");
    expect(guessCategory(undefined, "7 kW tethered charger")).toBe("ev_charger");
    expect(guessCategory("", "Roof hooks (pack of 10)")).toBe("mounting");
    expect(guessCategory("", "Widget")).toBe("other");
  });
  it("types spec values and rejects non-numbers", () => {
    expect(parseSpecs("ev_charger", { rated_kw: "7.4", tethered: "yes", phases: "" })).toEqual({ specs: { rated_kw: 7.4, tethered: true } });
    expect(parseSpecs("panel", { watts_peak: "lots" })).toEqual({ error: "Peak power: enter a number" });
  });
});

describe("bestOffer", () => {
  const offers = [
    { supplierId: "A", costPence: 9600, stockQty: 120, leadTimeDays: null },
    { supplierId: "B", costPence: 9900, stockQty: 50, leadTimeDays: null },
    { supplierId: "C", costPence: 9000, stockQty: 0, leadTimeDays: 5 },
  ];
  it("picks the cheapest in stock", () => expect(bestOffer(offers, 18)?.supplierId).toBe("A"));
  it("falls back to the cheapest when nobody has enough", () => expect(bestOffer(offers, 500)?.supplierId).toBe("C"));
  it("ignores unpriced offers", () => expect(bestOffer([{ supplierId: "X", costPence: null, stockQty: 9, leadTimeDays: null }])).toBeNull());
});
