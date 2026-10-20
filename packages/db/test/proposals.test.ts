import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Proposals");
  b = await seedCompany("Other proposals");
});
afterAll(() => pool.end());

const newProposal = (s: SeedCompany, version = 1) =>
  asUser(
    s.users.office,
    async (c) => {
      const n = (await c.query("select public.next_document_number('proposal') as n")).rows[0].n;
      const id = (await c.query("insert into proposals (project_id, number, version, deposit_pct, title) values ($1, $2, $3, 25, 'T') returning id", [s.projectId, n, version])).rows[0].id as string;
      await c.query("insert into proposal_lines (proposal_id, section, description, quantity, unit_price_pence, vat_rate, line_total_pence) values ($1, 'solar', 'Panels', 1, 1000, 0, 1000)", [id]);
      return id;
    },
    { commit: true },
  );

describe("proposals", () => {
  it("numbers proposals per company", async () => {
    const n1 = await asUser(a.users.office, async (c) => (await c.query("select public.next_document_number('proposal') as n")).rows[0].n, { commit: true });
    const n2 = await asUser(a.users.office, async (c) => (await c.query("select public.next_document_number('proposal') as n")).rows[0].n, { commit: true });
    const nb = await asUser(b.users.office, async (c) => (await c.query("select public.next_document_number('invoice') as n")).rows[0].n, { commit: true });
    expect(n2).toBe(n1 + 1);
    expect(nb).toBe(1);
    expect(await errorCode(asUser(a.users.installer, (c) => c.query("select public.next_document_number('proposal')")))).toBe("42501");
  });

  it("freezes a sent proposal and its lines", async () => {
    const id = await newProposal(a);
    await asUser(a.users.office, (c) => c.query("update proposals set status = 'sent', sent_at = now() where id = $1", [id]), { commit: true });
    expect(await errorCode(asUser(a.users.office, (c) => c.query("update proposals set total_pence = 1 where id = $1", [id])))).toBe("23514");
    expect(await errorCode(asUser(a.users.office, (c) => c.query("update proposal_lines set unit_price_pence = 1 where proposal_id = $1", [id])))).toBe("23514");
    expect(await errorCode(asUser(a.users.office, (c) => c.query("delete from proposal_lines where proposal_id = $1", [id])))).toBe("23514");
  });

  it("only lets the customer (service role) mark a proposal viewed or accepted", async () => {
    const id = await newProposal(a, 1);
    await asUser(a.users.office, (c) => c.query("update proposals set status = 'sent' where id = $1", [id]), { commit: true });
    for (const status of ["viewed", "accepted"]) {
      expect(await errorCode(asUser(a.users.admin, (c) => c.query("update proposals set status = $2 where id = $1", [id, status])))).toBe("42501");
    }
    await asSuperuser((c) => c.query("update proposals set status = 'accepted', accepted_at = now(), accepted_name = 'C' where id = $1", [id]));
  });

  it("keeps proposals, invoices and payments to office staff of the same company", async () => {
    await newProposal(b);
    const inv = await asSuperuser(
      async (c) => (await c.query("insert into invoices (company_id, project_id, kind, number, amount_pence) values ($1, $2, 'deposit', 'INV-1', 100) returning id", [b.companyId, b.projectId])).rows[0].id,
    );
    await asSuperuser((c) => c.query("insert into payments (company_id, invoice_id, amount_pence, method, status) values ($1, $2, 100, 'card', 'succeeded')", [b.companyId, inv]));
    expect(await asUser(a.users.office, async (c) => (await c.query("select 1 from proposals where company_id = $1", [b.companyId])).rowCount)).toBe(0);
    expect(await asUser(a.users.office, async (c) => (await c.query("select 1 from invoices union all select 1 from payments")).rowCount)).toBe(0);
    for (const role of ["installer", "subcontractor"] as const) {
      expect(await asUser(b.users[role], async (c) => (await c.query("select 1 from proposals union all select 1 from proposal_lines union all select 1 from invoices union all select 1 from payments")).rowCount)).toBe(0);
    }
    expect(await asUser(b.users.office, async (c) => (await c.query("select 1 from invoices")).rowCount)).toBe(1);
  });

  it("stops staff recording card payments (only the Stripe webhook does)", async () => {
    const inv = await asUser(a.users.office, async (c) => (await c.query("insert into invoices (project_id, kind, number, amount_pence) values ($1, 'deposit', 'INV-A', 100) returning id", [a.projectId])).rows[0].id, { commit: true });
    expect(await errorCode(asUser(a.users.office, (c) => c.query("insert into payments (invoice_id, amount_pence, method, status) values ($1, 100, 'card', 'succeeded')", [inv])))).toBe("42501");
    await asUser(a.users.office, (c) => c.query("insert into payments (invoice_id, amount_pence, method, status) values ($1, 100, 'bank_transfer', 'succeeded')", [inv]));
  });

  it("can't put another company's project on a proposal", async () => {
    const err = await errorCode(asUser(a.users.office, (c) => c.query("insert into proposals (project_id, number, version, deposit_pct) values ($1, 999, 1, 25)", [b.projectId])));
    expect(err).toBe("23503");
  });
});
