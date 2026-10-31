import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Push");
  b = await seedCompany("Other push");
});
afterAll(() => pool.end());

describe("push devices", () => {
  it("people register and see only their own phones", async () => {
    await asUser(a.users.installer, (c) => c.query("insert into push_devices (user_id, token, platform) values ($1, 'ExponentPushToken[abc123]', 'android')", [a.users.installer]), { commit: true });
    expect(await asUser(a.users.installer, async (c) => (await c.query("select token from push_devices")).rows)).toEqual([{ token: "ExponentPushToken[abc123]" }]);
    expect(await asUser(a.users.admin, async (c) => (await c.query("select 1 from push_devices")).rowCount)).toBe(0);
    expect(await asUser(b.users.admin, async (c) => (await c.query("select 1 from push_devices")).rowCount)).toBe(0);
    expect(await errorCode(asUser(a.users.installer, (c) => c.query("insert into push_devices (user_id, token, platform) values ($1, 'ExponentPushToken[zzz]', 'ios')", [a.users.office])))).toBe("42501");
    expect(await errorCode(asUser(a.users.installer, (c) => c.query("insert into push_devices (user_id, token, platform) values ($1, 'not-a-token', 'ios')", [a.users.installer])))).toBe("23514");
  });
});
