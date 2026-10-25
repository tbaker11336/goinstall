import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Notify");
  b = await seedCompany("Other notify");
});
afterAll(() => pool.end());

describe("notifications", () => {
  it("are private to the recipient, created server-side, and only marked read", async () => {
    const id = await asSuperuser(async (c) => (await c.query("insert into notifications (company_id, user_id, event, title, link) values ($1, $2, 'new_enquiry', 'New enquiry', '/projects') returning id", [a.companyId, a.users.office])).rows[0].id);
    expect(await asUser(a.users.office, async (c) => (await c.query("select title from notifications")).rows)).toEqual([{ title: "New enquiry" }]);
    expect(await asUser(a.users.admin, async (c) => (await c.query("select 1 from notifications")).rowCount)).toBe(0);
    expect(await asUser(b.users.admin, async (c) => (await c.query("select 1 from notifications")).rowCount)).toBe(0);
    await asUser(a.users.office, (c) => c.query("update notifications set read_at = now() where id = $1", [id]), { commit: true });
    expect(await asSuperuser(async (c) => (await c.query("select read_at is not null as read from notifications where id = $1", [id])).rows[0].read)).toBe(true);
    expect(await errorCode(asUser(a.users.office, (c) => c.query("update notifications set title = 'x' where id = $1", [id])))).toBe("42501");
    expect(await errorCode(asUser(a.users.office, (c) => c.query("insert into notifications (user_id, event, title) values ($1, 'new_enquiry', 'x')", [a.users.office])))).toBe("42501");
    // Links stay inside the console.
    expect(await errorCode(asSuperuser((c) => c.query("insert into notifications (company_id, user_id, event, title, link) values ($1, $2, 'new_enquiry', 'x', 'https://evil.test')", [a.companyId, a.users.office])))).toBe("23514");
  });

  it("send log: office can read, nobody can write, one row per reminder step", async () => {
    await asSuperuser((c) => c.query("insert into notification_log (company_id, event, entity_id, step) values ($1, 'survey_reminder', gen_random_uuid(), 0)", [a.companyId]));
    expect(await asUser(a.users.office, async (c) => (await c.query("select 1 from notification_log")).rowCount)).toBe(1);
    expect(await asUser(a.users.installer, async (c) => (await c.query("select 1 from notification_log")).rowCount)).toBe(0);
    expect(await errorCode(asUser(a.users.admin, (c) => c.query("insert into notification_log (event, entity_id) values ('x', gen_random_uuid())")))).toBe("42501");
  });
});

describe("SMS add-on", () => {
  it("admins see it and fill in business details; billing and the number are GoInstall's", async () => {
    await asSuperuser((c) => c.query("insert into sms_accounts (company_id, status) values ($1, 'pending_number')", [a.companyId]));
    expect(await asUser(a.users.office, async (c) => (await c.query("select 1 from sms_accounts")).rowCount)).toBe(0);
    expect(await asUser(b.users.admin, async (c) => (await c.query("select 1 from sms_accounts")).rowCount)).toBe(0);
    await asUser(a.users.admin, (c) => c.query(`update sms_accounts set business_details = '{"legalName": "Notify Ltd"}'`), { commit: true });
    expect(await asUser(a.users.admin, async (c) => (await c.query("select business_details->>'legalName' as n from sms_accounts")).rows[0].n)).toBe("Notify Ltd");
    expect(await errorCode(asUser(a.users.admin, (c) => c.query("update sms_accounts set status = 'active'")))).toBe("42501");
    expect(await errorCode(asUser(a.users.admin, (c) => c.query("update sms_accounts set phone_number = '+447700900123'")))).toBe("42501");
  });
});
