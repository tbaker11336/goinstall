import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Chat");
  b = await seedCompany("Other chat");
  await asSuperuser(async (c) => {
    const booking = (await c.query("insert into bookings (company_id, project_id, type, starts_at, ends_at) values ($1, $2, 'install', '2026-11-02', '2026-11-03') returning id", [a.companyId, a.projectId])).rows[0].id;
    await c.query("insert into booking_assignments (company_id, booking_id, role, user_id) values ($1, $2, 'electrician', $3)", [a.companyId, booking, a.users.installer]);
  });
});
afterAll(() => pool.end());

const say = (userId: string, body: string, projectId = a.projectId, authorId = userId) =>
  asUser(userId, (c) => c.query("insert into team_messages (id, project_id, author_id, body) values ($1, $2, $3, $4)", [randomUUID(), projectId, authorId, body]), { commit: true });

describe("team messages", () => {
  it("the office and the installer on the job can chat; nobody else can see it", async () => {
    await say(a.users.office, "Scaffold goes up at 8");
    await say(a.users.installer, "Thanks, on it");
    const seen = async (u: string) => (await asUser(u, (c) => c.query("select body from team_messages order by sent_at"))).rows.map((r) => r.body);
    expect(await seen(a.users.admin)).toEqual(["Scaffold goes up at 8", "Thanks, on it"]);
    expect(await seen(a.users.installer)).toHaveLength(2);
    // Not booked on this job.
    expect(await seen(a.users.subcontractor)).toEqual([]);
    expect(await errorCode(say(a.users.subcontractor, "hello"))).toBe("42501");
    expect(await seen(b.users.admin)).toEqual([]);
  });

  it("people write only as themselves and can't edit messages; read markers are their own", async () => {
    expect(await errorCode(say(a.users.installer, "pretending", a.projectId, a.users.office))).toBe("42501");
    expect(await asUser(a.users.office, async (c) => (await c.query("update team_messages set body = 'changed'")).rowCount)).toBe(0);
    await asUser(a.users.installer, (c) => c.query("insert into team_message_reads (project_id, user_id) values ($1, $2)", [a.projectId, a.users.installer]), { commit: true });
    expect(await asUser(a.users.office, async (c) => (await c.query("select 1 from team_message_reads")).rowCount)).toBe(0);
    expect(await errorCode(asUser(a.users.office, (c) => c.query("insert into team_message_reads (project_id, user_id) values ($1, $2)", [a.projectId, a.users.installer])))).toBe("42501");
  });
});
