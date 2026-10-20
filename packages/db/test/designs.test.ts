import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Design");
  b = await seedCompany("Other design");
});
afterAll(() => pool.end());

describe("design versions", () => {
  it("keeps one active version and refuses edits to saved versions", async () => {
    await asUser(a.users.office, (c) => c.query("insert into solar_designs (project_id, version, panel_count) values ($1, 1, 10)", [a.projectId]), { commit: true });
    const dup = asUser(a.users.office, (c) => c.query("insert into solar_designs (project_id, version, panel_count) values ($1, 2, 12)", [a.projectId]));
    expect(await errorCode(dup)).toBe("23505"); // second active version
    await asUser(
      a.users.office,
      async (c) => {
        await c.query("update solar_designs set is_active = false where project_id = $1", [a.projectId]);
        await c.query("insert into solar_designs (project_id, version, panel_count) values ($1, 2, 12)", [a.projectId]);
      },
      { commit: true },
    );
    const edit = asUser(a.users.office, (c) => c.query("update solar_designs set panel_count = 99 where project_id = $1 and version = 1", [a.projectId]));
    expect(await errorCode(edit)).toBe("23514");
    const rows = await asUser(a.users.office, async (c) => (await c.query("select version, is_active, panel_count from solar_designs order by version")).rows);
    expect(rows).toEqual([
      { version: 1, is_active: false, panel_count: 10 },
      { version: 2, is_active: true, panel_count: 12 },
    ]);
  });

  it("hides designs from other companies, installers and subcontractors", async () => {
    await asSuperuser((c) => c.query("insert into ev_designs (company_id, project_id, version) values ($1, $2, 1)", [b.companyId, b.projectId]));
    expect(await asUser(a.users.office, async (c) => (await c.query("select 1 from ev_designs")).rowCount)).toBe(0);
    for (const role of ["installer", "subcontractor"] as const) {
      expect(await asUser(a.users[role], async (c) => (await c.query("select 1 from solar_designs union all select 1 from calc_tables")).rowCount)).toBe(0);
    }
  });

  it("can't use another company's product in a design", async () => {
    const pb = await asSuperuser(async (c) => (await c.query("insert into products (company_id, category, name, model) values ($1, 'panel', 'P', 'X') returning id", [b.companyId])).rows[0].id);
    const err = await errorCode(asUser(a.users.office, (c) => c.query("insert into ev_designs (project_id, version, charger_product_id) values ($1, 1, $2)", [a.projectId, pb])));
    expect(err).toBe("23503");
  });
});

describe("rule tables", () => {
  it("are admin-managed, one active version per kind", async () => {
    const office = asUser(a.users.office, (c) => c.query("insert into calc_tables (kind, version, rows, source_note) values ('mcs_zones', 1, '[{}]', 'x')"));
    expect(await errorCode(office)).toBe("42501");
    await asUser(a.users.admin, (c) => c.query("insert into calc_tables (kind, version, rows, source_note) values ('mcs_zones', 1, '[{}]', 'test')"), { commit: true });
    const second = asUser(a.users.admin, (c) => c.query("insert into calc_tables (kind, version, rows, source_note) values ('mcs_zones', 2, '[{}]', 'test')"));
    expect(await errorCode(second)).toBe("23505");
    const noSource = asUser(a.users.admin, (c) => c.query("insert into calc_tables (kind, version, rows, source_note, is_active) values ('mcs_zones', 3, '[{}]', ' ', false)"));
    expect(await errorCode(noSource)).toBe("23514");
  });
});
