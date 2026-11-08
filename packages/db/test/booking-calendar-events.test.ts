import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Calendar");
  b = await seedCompany("Other calendar");
  await asSuperuser(async (c) => {
    const booking = (await c.query("insert into bookings (company_id, project_id, type, starts_at, ends_at) values ($1, $2, 'install', '2026-11-09', '2026-11-10') returning id", [a.companyId, a.projectId])).rows[0].id;
    await c.query("insert into booking_calendar_events (company_id, booking_id, user_id, event_id) values ($1, $2, $3, 'evt-installer'), ($1, $2, $4, 'evt-office')", [a.companyId, booking, a.users.installer, a.users.office]);
  });
});
afterAll(() => pool.end());

describe("booking calendar events", () => {
  it("people see their own events, the office sees all, other companies none; only the server writes them", async () => {
    const ids = async (u: string) => (await asUser(u, (c) => c.query("select event_id from booking_calendar_events order by event_id"))).rows.map((r) => r.event_id);
    expect(await ids(a.users.installer)).toEqual(["evt-installer"]);
    expect(await ids(a.users.office)).toEqual(["evt-installer", "evt-office"]);
    expect(await ids(b.users.admin)).toEqual([]);
    // No write policies: deleting matches nothing, inserting is refused.
    expect((await asUser(a.users.admin, (c) => c.query("delete from booking_calendar_events"), { commit: true })).rowCount).toBe(0);
    expect(await ids(a.users.office)).toHaveLength(2);
    expect(await errorCode(asUser(a.users.admin, (c) => c.query("insert into booking_calendar_events (booking_id, user_id, event_id) select booking_id, user_id, 'x' from booking_calendar_events limit 1")))).toBe("42501");
  });
});
