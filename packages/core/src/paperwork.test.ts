import { describe, expect, it } from "vitest";
import { isValidMpanCore, missingValues, paperworkFor, paperworkValues, type PaperworkContext } from "./paperwork";

const base = { solar: null, ev: false, hasInstall: false, installStart: null, commissionedAt: null, warranties: [] };

describe("paperworkFor", () => {
  it("solar G98 with battery and an install: notification 28 days after commissioning, MCS, EIC, warranties, handover", () => {
    const items = paperworkFor({
      ...base,
      solar: { connectionForm: "G98" },
      hasInstall: true,
      installStart: new Date("2026-11-02T00:00:00Z"),
      commissionedAt: new Date("2026-11-03T15:00:00Z"),
      warranties: [{ productId: "p1", name: "445 W panel" }, { productId: "i1", name: "5 kW inverter" }],
    });
    expect(items.map((i) => [i.kind, i.timing, i.dueDate])).toEqual([
      ["g98_notification", "after_commissioning", "2026-12-01"],
      ["mcs_certificate", "after_commissioning", null],
      ["eic", "after_install", null],
      ["warranty_registration", "after_install", null],
      ["warranty_registration", "after_install", null],
      ["handover_pack", "on_completion", null],
    ]);
    expect(items[3]).toMatchObject({ productId: "p1", title: "Warranty registration: 445 W panel" });
    expect(items[0]!.dueNote).toMatch(/28 days.*G98/);
  });

  it("G99 is due before the install starts; EV adds its notification", () => {
    const items = paperworkFor({ ...base, solar: { connectionForm: "G99" }, ev: true, hasInstall: true, installStart: new Date("2026-11-10T08:00:00Z") });
    expect(items.find((i) => i.kind === "g99_application")).toMatchObject({ timing: "before_install", dueDate: "2026-11-10" });
    expect(items.some((i) => i.kind === "g98_notification")).toBe(false);
    expect(items.find((i) => i.kind === "ev_dno_notification")).toMatchObject({ timing: "after_install", dueDate: null });
  });

  it("nothing before a design or install; no DNO item until the connection form is known", () => {
    expect(paperworkFor(base)).toEqual([]);
    expect(paperworkFor({ ...base, solar: { connectionForm: null } }).map((i) => i.kind)).toEqual(["mcs_certificate"]);
  });
});

describe("isValidMpanCore", () => {
  it("checks the check digit", () => {
    // 12 digits, then the check digit computed by the published method.
    const first = "120002330596";
    const primes = [3, 5, 7, 13, 17, 19, 23, 29, 31, 37, 41, 43];
    const check = (primes.reduce((n, p, k) => n + p * Number(first[k]), 0) % 11) % 10;
    expect(isValidMpanCore(`${first}${check}`)).toBe(true);
    expect(isValidMpanCore(`${first}${(check + 1) % 10}`)).toBe(false);
    expect(isValidMpanCore("12 0002 3305 96" + check)).toBe(true);
    expect(isValidMpanCore("123")).toBe(false);
  });
});

const ctx: PaperworkContext = {
  company: { name: "Brightside Solar", address: "1 Depot Rd", phone: "0117 000 0000", email: "office@brightside.test", mcsNumber: "NAP-12345", competentPersonScheme: null },
  customer: { name: "Rachel Bennett", phone: null, email: "rachel@example.com" },
  site: { address: "8 Elm Close, Portishead", postcode: "BS20 6RT", mpan: null },
  supply: { phases: 1, mainFuseA: 100, earthing: "TN-C-S" },
  solar: {
    panel: { make: "Demo Solar", model: "DS-445-BLK", count: 12 },
    kWp: 5.34,
    inverter: { make: "Demo Power", model: "DP-5H", acKw: 5, phases: 1, enaRef: null },
    battery: { make: "Demo Power", model: "DP-B10", usableKwh: 9.5, powerKw: 5, count: 1, enaRef: "B-123" },
    exportKw: 5,
    annualKwh: 4800,
    mcsZone: "5E",
  },
  ev: null,
  installedAt: new Date("2026-11-03T08:00:00Z"),
  commissionedAt: new Date("2026-11-03T15:00:00Z"),
  readings: [{ step: "DC string tests", product: "solar", values: [{ label: "Open-circuit voltage", value: "412", unit: "V" }] }],
  serials: [{ step: "Inverter installed", product: "solar", serial: "INV-001" }],
};

describe("paperworkValues", () => {
  it("pre-fills a G98 notification and lists the gaps", () => {
    const vals = paperworkValues("g98_notification", ctx, { isolator_location: "Next to the meter" });
    const get = (k: string) => vals.find((v) => v.key === k)?.value;
    expect(get("registered_capacity")).toBe("5 kW AC");
    expect(get("storage_kwh")).toBe("9.5 kWh");
    expect(get("battery_ena_ref")).toBe("B-123");
    expect(get("commissioned_at")).toBe("3 November 2026");
    expect(get("isolator_location")).toBe("Next to the meter");
    expect(missingValues(vals)).toEqual(["MPAN", "Inverter: ENA type test register Product ID", "Location of the micro-generator in the installation"]);
  });

  it("puts install readings on the MCS summary and EIC sheet, serials on warranties", () => {
    expect(paperworkValues("mcs_certificate", ctx).find((v) => v.label === "DC string tests: Open-circuit voltage")?.value).toBe("412 V");
    expect(paperworkValues("eic", ctx).find((v) => v.key === "main_fuse")?.value).toBe("100 A");
    expect(paperworkValues("warranty_registration", ctx).find((v) => v.key === "serial_0")?.value).toBe("INV-001");
  });
});

describe("optional values", () => {
  it("an export limitation scheme isn't a gap when there isn't one", () => {
    const vals = paperworkValues("g99_application", { ...ctx, site: { ...ctx.site, mpan: "1200023305967" } }, { isolator_location: "Garage" });
    expect(missingValues(vals)).not.toContain("Export limitation scheme (if any)");
  });
});
