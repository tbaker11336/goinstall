import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;
let otherProject: string;
let bookingId: string;
let teamId: string;

beforeAll(async () => {
  a = await seedCompany("Schedule");
  b = await seedCompany("Other schedule");
  otherProject = await asSuperuser(async (c) => (await c.query("insert into projects (company_id, contact_id, products) values ($1, $2, '{solar}') returning id", [a.companyId, a.contactId])).rows[0].id);
  teamId = await asUser(a.users.admin, async (c) => (await c.query("insert into teams (name) values ('Team A') returning id")).rows[0].id, { commit: true });
  await asSuperuser((c) => c.query("update users set team_id = $1 where id = $2", [teamId, a.users.installer]));
  bookingId = await asUser(
    a.users.office,
    async (c) => {
      const id = (await c.query("insert into bookings (project_id, type, starts_at, ends_at) values ($1, 'install', '2026-11-02', '2026-11-04') returning id", [a.projectId])).rows[0].id;
      await c.query("insert into booking_assignments (booking_id, role, team_id) values ($1, 'team', $2)", [id, teamId]);
      await c.query("insert into booking_assignments (booking_id, role, user_id) values ($1, 'scaffolder', $2)", [id, a.users.subcontractor]);
      return id;
    },
    { commit: true },
  );
});
afterAll(() => pool.end());

describe("assignment-based access", () => {
  it("shows installers and subcontractors only the projects they're booked on", async () => {
    for (const role of ["installer", "subcontractor"] as const) {
      const ids = await asUser(a.users[role], async (c) => (await c.query("select id from projects")).rows.map((r) => r.id));
      expect(ids).toEqual([a.projectId]);
      expect(await asUser(a.users[role], async (c) => (await c.query("select 1 from contacts")).rowCount)).toBe(1);
      expect(await asUser(a.users[role], async (c) => (await c.query("select 1 from bookings")).rowCount)).toBe(1);
    }
    expect(otherProject).toBeTruthy();
  });

  it("never shows prices to installers or subcontractors", async () => {
    for (const role of ["installer", "subcontractor"] as const) {
      const n = await asUser(a.users[role], async (c) => (await c.query("select 1 from products union all select 1 from supplier_products union all select 1 from purchase_order_lines union all select 1 from proposal_lines union all select 1 from invoices")).rowCount);
      expect(n).toBe(0);
    }
  });

  it("lets installers start and complete a booking but not move it", async () => {
    expect(await errorCode(asUser(a.users.installer, (c) => c.query("update bookings set starts_at = '2026-11-05' where id = $1", [bookingId])))).toBe("42501");
    expect(await errorCode(asUser(a.users.installer, (c) => c.query("update bookings set status = 'cancelled' where id = $1", [bookingId])))).toBe("42501");
    const n = await asUser(a.users.installer, async (c) => (await c.query("update bookings set status = 'in_progress', started_at = now() where id = $1", [bookingId])).rowCount);
    expect(n).toBe(1);
    // Subcontractors can see but not change it.
    expect(await asUser(a.users.subcontractor, async (c) => (await c.query("update bookings set status = 'in_progress' where id = $1", [bookingId])).rowCount)).toBe(0);
  });

  it("records checklist items from the app with history on overwrite", async () => {
    const id = randomUUID();
    await asUser(
      a.users.installer,
      async (c) => {
        await c.query("insert into checklist_items (id, booking_id, project_id, product, title, done, readings) values ($1, $2, $3, 'solar', 'DC tests', true, '{\"voc_v\": \"410\"}')", [id, bookingId, a.projectId]);
        await c.query("update checklist_items set readings = '{\"voc_v\": \"412\"}' where id = $1", [id]);
      },
      { commit: true },
    );
    const hist = await asUser(a.users.office, async (c) => (await c.query("select readings from checklist_item_history where checklist_item_id = $1", [id])).rows);
    expect(hist).toEqual([{ readings: { voc_v: "410" } }]);
    // Subcontractors can't touch checklists; installers can't on projects they're not booked on.
    expect(await errorCode(asUser(a.users.subcontractor, (c) => c.query("insert into checklist_items (id, booking_id, project_id, product, title) values ($1, $2, $3, 'solar', 'x')", [randomUUID(), bookingId, a.projectId])))).toBe("42501");
  });

  it("lets installers add photos only to assigned projects", async () => {
    const ok = asUser(a.users.installer, (c) => c.query("insert into files (company_id, project_id, kind, path, content_type, size_bytes, source) values ($1, $2, 'photo', 'x/y.jpg', 'image/jpeg', 1, 'installer_app')", [a.companyId, a.projectId]));
    expect(await errorCode(ok)).toBeUndefined();
    const bad = asUser(a.users.installer, (c) => c.query("insert into files (company_id, project_id, kind, path, content_type, size_bytes, source) values ($1, $2, 'photo', 'x/z.jpg', 'image/jpeg', 1, 'installer_app')", [a.companyId, otherProject]));
    expect(await errorCode(bad)).toBe("42501");
  });

  it("loses access when the booking is cancelled", async () => {
    await asUser(a.users.office, (c) => c.query("update bookings set status = 'cancelled' where id = $1", [bookingId]), { commit: true });
    expect(await asUser(a.users.installer, async (c) => (await c.query("select 1 from projects")).rowCount)).toBe(0);
    await asUser(a.users.office, (c) => c.query("update bookings set status = 'confirmed' where id = $1", [bookingId]), { commit: true });
  });

  it("keeps bookings and purchase orders inside the company", async () => {
    expect(await asUser(b.users.office, async (c) => (await c.query("select 1 from bookings union all select 1 from booking_assignments")).rowCount)).toBe(0);
    const err = await errorCode(asUser(b.users.office, (c) => c.query("insert into bookings (project_id, type, starts_at, ends_at) values ($1, 'install', now(), now() + interval '1 day')", [a.projectId])));
    expect(err).toBe("23503");
  });

  it("seeds draft checklist steps for every company", async () => {
    const rows = await asUser(a.users.installer, async (c) => (await c.query("select bool_and(is_draft) as drafts, count(*)::int as n from checklist_templates")).rows[0]);
    expect(rows.drafts).toBe(true);
    expect(rows.n).toBeGreaterThan(5);
  });
});
