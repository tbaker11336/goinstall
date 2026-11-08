import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Tokens");
  await asSuperuser(async (c) => {
    const id = (await c.query("insert into integrations (company_id, provider, status) values ($1, 'xero', 'connected') returning id", [a.companyId])).rows[0].id;
    await c.query("insert into private.integration_secrets (integration_id, company_id, ciphertext) values ($1, $2, 'sealed')", [id, a.companyId]);
  });
});
afterAll(() => pool.end());

describe("connected-service tokens", () => {
  it("can't be read or written by anyone signed in, admins included", async () => {
    for (const role of ["admin", "office", "installer"] as const) {
      expect(await errorCode(asUser(a.users[role], (c) => c.query("select ciphertext from private.integration_secrets")))).toBe("42501");
      expect(await errorCode(asUser(a.users[role], (c) => c.query("delete from private.integration_secrets")))).toBe("42501");
    }
    // Admins see the connection itself, not the tokens.
    expect((await asUser(a.users.admin, (c) => c.query("select provider, status from integrations"))).rows).toEqual([{ provider: "xero", status: "connected" }]);
    expect((await asUser(a.users.office, (c) => c.query("select 1 from integrations"))).rowCount).toBe(0);
  });
});
