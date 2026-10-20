import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Papers");
  b = await seedCompany("Other papers");
});
afterAll(() => pool.end());

describe("paperwork items", () => {
  it("are office-only, inside the company, one per kind (per product for warranties)", async () => {
    const id = await asUser(a.users.office, async (c) => (await c.query("insert into paperwork_items (project_id, kind, title, timing) values ($1, 'eic', 'EIC', 'after_install') returning id", [a.projectId])).rows[0].id, { commit: true });
    const dup = asUser(a.users.office, (c) => c.query("insert into paperwork_items (project_id, kind, title, timing) values ($1, 'eic', 'EIC again', 'after_install')", [a.projectId]));
    expect(await errorCode(dup)).toBe("23505");
    for (const role of ["installer", "subcontractor"] as const) {
      expect(await asUser(a.users[role], async (c) => (await c.query("select 1 from paperwork_items")).rowCount)).toBe(0);
    }
    expect(await asUser(b.users.admin, async (c) => (await c.query("select 1 from paperwork_items where id = $1", [id])).rowCount)).toBe(0);
    // Another company's project can't be used.
    const cross = asUser(a.users.office, (c) => c.query("insert into paperwork_items (project_id, kind, title, timing) values ($1, 'eic', 'EIC', 'after_install')", [b.projectId]));
    expect(await errorCode(cross)).toBe("23503");
  });

  it("allow a warranty item per product, attached files, and only https portal links", async () => {
    const [p1, p2] = await asSuperuser(async (c) => (await c.query("insert into products (company_id, category, name, model) values ($1, 'panel', 'P', 'W1'), ($1, 'inverter', 'I', 'W2') returning id", [a.companyId])).rows.map((r) => r.id));
    await asUser(a.users.office, async (c) => {
      for (const p of [p1, p2]) await c.query("insert into paperwork_items (project_id, kind, product_id, title, timing) values ($1, 'warranty_registration', $2, 'W', 'after_install')", [a.projectId, p]);
      const item = (await c.query("select id from paperwork_items where product_id = $1", [p1])).rows[0].id;
      const f = await c.query("insert into files (project_id, kind, path, content_type, size_bytes, source, paperwork_item_id, uploaded_by) values ($1, 'document', $2, 'application/pdf', 10, 'generated', $3, $4) returning paperwork_item_id", [a.projectId, `${a.companyId}/${a.projectId}/x.pdf`, item, a.users.office]);
      expect(f.rows[0].paperwork_item_id).toBe(item);
    });
    const bad = asUser(a.users.office, (c) => c.query("insert into paperwork_items (project_id, kind, title, timing, portal_url) values ($1, 'g98_notification', 'G98', 'after_commissioning', 'http://dno.example')", [a.projectId]));
    expect(await errorCode(bad)).toBe("23514");
    const mpan = asUser(a.users.office, (c) => c.query("update projects set mpan = '12345' where id = $1", [a.projectId]));
    expect(await errorCode(mpan)).toBe("23514");
  });
});
