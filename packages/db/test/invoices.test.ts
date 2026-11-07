import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Invoicing");
  b = await seedCompany("Other invoicing");
});
afterAll(() => pool.end());

const raise = (userId: string, projectId: string, kind: string, number: string, amount = 10_000, vat = 0) =>
  asUser(userId, (c) => c.query("insert into invoices (project_id, kind, number, amount_pence, vat_pence, description) values ($1, $2, $3, $4, $5, 'Scaffold up and panels fitted')", [projectId, kind, number, amount, vat]), { commit: true });

describe("invoices", () => {
  it("office staff raise stage and extra-work invoices; installers and other companies can't see them", async () => {
    await raise(a.users.office, a.projectId, "stage", "T-INV-1", 120_000, 20_000);
    await raise(a.users.admin, a.projectId, "extra", "T-INV-2", 12_000, 2_000);
    expect((await asUser(a.users.office, (c) => c.query("select kind from invoices order by number"))).rows.map((r) => r.kind)).toEqual(["stage", "extra"]);
    expect((await asUser(a.users.installer, (c) => c.query("select 1 from invoices"))).rowCount).toBe(0);
    expect((await asUser(b.users.admin, (c) => c.query("select 1 from invoices"))).rowCount).toBe(0);
    expect(await errorCode(raise(a.users.installer, a.projectId, "stage", "T-INV-3"))).toBe("42501");
    expect(await errorCode(raise(b.users.office, a.projectId, "stage", "T-INV-4"))).toBe("23503");
  });

  it("only knows the four kinds, and VAT can't be more than the amount", async () => {
    expect(await errorCode(raise(a.users.office, a.projectId, "refund", "T-INV-5"))).toBe("23514");
    expect(await errorCode(raise(a.users.office, a.projectId, "stage", "T-INV-6", 100, 101))).toBe("23514");
  });
});
