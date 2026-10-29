import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;
let booking: string;
let other: string;

beforeAll(async () => {
  a = await seedCompany("Answers");
  b = await seedCompany("Other answers");
  await asSuperuser(async (c) => {
    booking = (await c.query("insert into bookings (company_id, project_id, type, starts_at, ends_at) values ($1, $2, 'install', '2026-11-02', '2026-11-03') returning id", [a.companyId, a.projectId])).rows[0].id;
    await c.query("insert into booking_assignments (company_id, booking_id, role, user_id) values ($1, $2, 'electrician', $3)", [a.companyId, booking, a.users.installer]);
    // A booking the installer isn't on.
    other = (await c.query("insert into bookings (company_id, project_id, type, starts_at, ends_at) values ($1, $2, 'survey', '2026-11-05 10:00', '2026-11-05 12:00') returning id", [a.companyId, a.projectId])).rows[0].id;
  });
});
afterAll(() => pool.end());

const answer = (bookingId: string, userId: string, response: string, reason: string | null) =>
  asUser(userId, (c) => c.query("insert into booking_responses (booking_id, user_id, response, reason, for_starts_at) values ($1, $2, $3, $4, '2026-11-02')", [bookingId, userId, response, reason]), { commit: true });

describe("booking responses", () => {
  it("an installer answers only for themselves, on jobs they're booked on", async () => {
    await answer(booking, a.users.installer, "accepted", null);
    expect(await asUser(a.users.installer, async (c) => (await c.query("select response from booking_responses")).rows)).toEqual([{ response: "accepted" }]);
    // Changing their mind, with a reason.
    await asUser(a.users.installer, (c) => c.query("update booking_responses set response = 'declined', reason = 'Van in for repair' where booking_id = $1", [booking]), { commit: true });
    expect(await asUser(a.users.office, async (c) => (await c.query("select response, reason from booking_responses")).rows)).toEqual([{ response: "declined", reason: "Van in for repair" }]);
    expect(await errorCode(answer(other, a.users.installer, "accepted", null))).toBe("42501");
    expect(await errorCode(answer(booking, a.users.subcontractor, "accepted", null))).toBe("42501");
    // Not on someone else's behalf.
    expect(await errorCode(asUser(a.users.installer, (c) => c.query("insert into booking_responses (booking_id, user_id, response, for_starts_at) values ($1, $2, 'accepted', now())", [booking, a.users.office])))).toBe("42501");
  });

  it("a decline needs a reason, and other companies see nothing", async () => {
    expect(await errorCode(asSuperuser((c) => c.query("insert into booking_responses (company_id, booking_id, user_id, response, for_starts_at) values ($1, $2, $3, 'declined', now())", [a.companyId, other, a.users.office])))).toBe("23514");
    expect(await asUser(b.users.admin, async (c) => (await c.query("select 1 from booking_responses")).rowCount)).toBe(0);
    expect(await asUser(a.users.subcontractor, async (c) => (await c.query("select 1 from booking_responses")).rowCount)).toBe(0);
  });
});
