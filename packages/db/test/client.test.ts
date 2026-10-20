import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createDb, withService, withUser } from "../src";
import { seedCompany, pool, type SeedCompany } from "./helpers";

const db = createDb({ connectionString: inject("testDatabaseUrl"), max: 2 });
let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Client");
  b = await seedCompany("ClientOther");
});

afterAll(async () => {
  await db.destroy();
  await pool.end();
});

describe("withUser", () => {
  it("applies RLS as the given user", async () => {
    const companies = await withUser(db, a.users.office, (tx) => tx.selectFrom("projects").select("company_id").distinct().execute());
    expect(companies).toEqual([{ company_id: a.companyId }]);
  });

  it("parses enum arrays", async () => {
    const p = await withUser(db, a.users.office, (tx) => tx.selectFrom("projects").select("products").where("id", "=", a.projectId).executeTakeFirstOrThrow());
    expect(p.products).toEqual(["solar", "ev"]);
  });

  it("does not leak the user's role to the next query on the connection", async () => {
    await withUser(db, a.users.office, (tx) => tx.selectFrom("contacts").select("id").execute());
    const all = await withService(db, (tx) => tx.selectFrom("companies").select("id").where("id", "in", [a.companyId, b.companyId]).execute());
    expect(all).toHaveLength(2);
  });

  it("fills company_id on teams created by an admin", async () => {
    const team = await withUser(db, a.users.admin, (tx) => tx.insertInto("teams").values({ name: "Team Z" }).returning("company_id").executeTakeFirstOrThrow());
    expect(team.company_id).toBe(a.companyId);
  });
});
