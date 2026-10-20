import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;
let supplierA: string;
let productA: string;
let productB: string;

beforeAll(async () => {
  a = await seedCompany("Cat");
  b = await seedCompany("Dog");
  ({ supplierA, productA, productB } = await asSuperuser(async (c) => {
    const s = await c.query("insert into suppliers (company_id, name) values ($1, 'Wholesale A') returning id", [a.companyId]);
    const p = await c.query("insert into products (company_id, category, name, model, sell_price_pence) values ($1, 'panel', 'Panel', 'P1', 16500) returning id", [a.companyId]);
    const pb = await c.query("insert into products (company_id, category, name, model) values ($1, 'panel', 'Rival panel', 'P1') returning id", [b.companyId]);
    await c.query("insert into supplier_products (company_id, supplier_id, product_id, cost_pence, stock_qty) values ($1, $2, $3, 9600, 10)", [a.companyId, s.rows[0].id, p.rows[0].id]);
    return { supplierA: s.rows[0].id, productA: p.rows[0].id, productB: pb.rows[0].id };
  }));
});

afterAll(() => pool.end());

describe("catalogue RLS", () => {
  it("lets office staff read their own catalogue and prices only", async () => {
    const seen = await asUser(a.users.office, async (c) => ({
      products: (await c.query("select id from products")).rows.map((r) => r.id),
      offers: (await c.query("select cost_pence from supplier_products")).rows.map((r) => Number(r.cost_pence)),
    }));
    expect(seen.products).toEqual([productA]);
    expect(seen.offers).toEqual([9600]);
  });

  it("hides prices and products from installers and subcontractors", async () => {
    for (const role of ["installer", "subcontractor"] as const) {
      const n = await asUser(a.users[role], async (c) => (await c.query("select 1 from products union all select 1 from supplier_products union all select 1 from suppliers")).rowCount);
      expect(n).toBe(0);
    }
  });

  it("only lets admins change prices", async () => {
    expect(await asUser(a.users.office, async (c) => (await c.query("update products set sell_price_pence = 1 where id = $1", [productA])).rowCount)).toBe(0);
    expect(await asUser(a.users.admin, async (c) => (await c.query("update products set sell_price_pence = 17000 where id = $1", [productA])).rowCount)).toBe(1);
    const insert = asUser(a.users.office, (c) => c.query("insert into suppliers (name) values ('Sneaky')"));
    expect(await errorCode(insert)).toBe("42501");
  });

  it("can't price another company's product", async () => {
    const err = await errorCode(asSuperuser((c) => c.query("insert into supplier_products (company_id, supplier_id, product_id, cost_pence) values ($1, $2, $3, 1)", [a.companyId, supplierA, productB])));
    expect(err).toBe("23503");
  });

  it("refuses negative prices and duplicate make and model", async () => {
    expect(await errorCode(asUser(a.users.admin, (c) => c.query("update products set sell_price_pence = -1 where id = $1", [productA])))).toBe("23514");
    expect(await errorCode(asUser(a.users.admin, (c) => c.query("insert into products (category, name, model) values ('panel', 'Copy', 'p1')")))).toBe("23505");
  });
});
