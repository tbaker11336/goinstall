import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Deletes");
});
afterAll(() => pool.end());

describe("deleting a project and a contact", () => {
  it("an admin deletes a project with a sent proposal, its lines, a booking and a void invoice; the contact stays", async () => {
    const projectId = await asSuperuser(async (c) => {
      const p = (await c.query("insert into projects (company_id, contact_id, products) values ($1, $2, '{solar}') returning id", [a.companyId, a.contactId])).rows[0].id;
      const pr = (await c.query("insert into proposals (company_id, project_id, number, version, deposit_pct, title, status) values ($1, $2, 901, 1, 25, 'Solar', 'draft') returning id", [a.companyId, p])).rows[0].id;
      await c.query("insert into proposal_lines (company_id, proposal_id, section, description, quantity, unit_price_pence, vat_rate, line_total_pence) values ($1, $2, 'solar', 'Panels', 1, 100000, 0, 100000)", [a.companyId, pr]);
      await c.query("update proposals set status = 'sent' where id = $1", [pr]);
      await c.query("insert into bookings (company_id, project_id, type, starts_at, ends_at) values ($1, $2, 'install', '2026-11-02', '2026-11-03')", [a.companyId, p]);
      await c.query("insert into invoices (company_id, project_id, proposal_id, kind, number, amount_pence, status) values ($1, $2, $3, 'deposit', 'DEL-INV-1', 100, 'void')", [a.companyId, p, pr]);
      await c.query("insert into messages (company_id, contact_id, project_id, channel, direction, body) values ($1, $2, $3, 'note', 'internal', 'Called about the roof')", [a.companyId, a.contactId, p]);
      return p;
    });
    // Office staff can't delete it.
    expect((await asUser(a.users.office, (c) => c.query("delete from projects where id = $1", [projectId]), { commit: true })).rowCount).toBe(0);
    expect((await asUser(a.users.admin, (c) => c.query("delete from projects where id = $1", [projectId]), { commit: true })).rowCount).toBe(1);
    await asSuperuser(async (c) => {
      expect((await c.query("select 1 from proposals where project_id = $1", [projectId])).rowCount).toBe(0);
      expect((await c.query("select 1 from bookings where project_id = $1", [projectId])).rowCount).toBe(0);
      // The note stays on the contact.
      expect((await c.query("select project_id from messages where body = 'Called about the roof'")).rows).toEqual([{ project_id: null }]);
    });
  });

  it("an admin deletes a contact with their projects and messages", async () => {
    const contactId = await asSuperuser(async (c) => {
      const ct = (await c.query("insert into contacts (company_id, name) values ($1, 'Gone Person') returning id", [a.companyId])).rows[0].id;
      await c.query("insert into projects (company_id, contact_id, products) values ($1, $2, '{ev}')", [a.companyId, ct]);
      await c.query("insert into messages (company_id, contact_id, channel, direction, body) values ($1, $2, 'note', 'internal', 'Hello')", [a.companyId, ct]);
      return ct;
    });
    expect((await asUser(a.users.office, (c) => c.query("delete from contacts where id = $1", [contactId]), { commit: true })).rowCount).toBe(0);
    await asUser(a.users.admin, async (c) => {
      await c.query("delete from projects where contact_id = $1", [contactId]);
      expect((await c.query("delete from contacts where id = $1", [contactId])).rowCount).toBe(1);
    }, { commit: true });
    await asSuperuser(async (c) => {
      expect((await c.query("select 1 from projects where contact_id = $1", [contactId])).rowCount).toBe(0);
      expect((await c.query("select 1 from messages where contact_id = $1", [contactId])).rowCount).toBe(0);
    });
  });
});
