import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Alpha");
  b = await seedCompany("Bravo");
});

afterAll(() => pool.end());

describe("tenant isolation", () => {
  it.each(["contacts", "projects", "users", "teams", "companies", "activity_log"])(
    "office staff see only their own company's %s",
    async (table) => {
      const companyIds = await asUser(a.users.office, async (c) => {
        const col = table === "companies" ? "id" : "company_id";
        const { rows } = await c.query(`select distinct ${col} as company_id from ${table}`);
        return rows.map((r) => r.company_id);
      });
      expect(companyIds.every((id) => id === a.companyId)).toBe(true);
    },
  );

  it("hides another company's project by id", async () => {
    const rows = await asUser(a.users.admin, async (c) =>
      (await c.query("select id from projects where id = $1", [b.projectId])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("fills company_id from the caller on insert", async () => {
    const companyId = await asUser(a.users.office, async (c) => {
      const { rows } = await c.query("insert into contacts (name) values ('New lead') returning company_id");
      return rows[0].company_id;
    });
    expect(companyId).toBe(a.companyId);
  });

  it("rejects inserting a contact into another company", async () => {
    const code = await errorCode(
      asUser(a.users.office, (c) =>
        c.query("insert into contacts (company_id, name) values ($1, 'Sneaky')", [b.companyId]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("rejects a project that points at another company's contact", async () => {
    const code = await errorCode(
      asUser(a.users.office, (c) =>
        c.query("insert into projects (contact_id) values ($1)", [b.contactId]),
      ),
    );
    expect(code).toBe("23503");
  });

  it("cannot update or delete another company's rows", async () => {
    const counts = await asUser(a.users.admin, async (c) => {
      const u = await c.query("update projects set value = 1 where id = $1", [b.projectId]);
      const d = await c.query("delete from contacts where id = $1", [b.contactId]);
      const users = await c.query("update users set full_name = 'x' where id = $1", [b.users.office]);
      return [u.rowCount, d.rowCount, users.rowCount];
    });
    expect(counts).toEqual([0, 0, 0]);
  });

  it("cannot move a row into another company", async () => {
    const code = await errorCode(
      asUser(a.users.admin, (c) =>
        c.query("update contacts set company_id = $1 where id = $2", [b.companyId, a.contactId]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("gives anonymous callers no access", async () => {
    const code = await errorCode(asUser(null, (c) => c.query("select * from contacts")));
    expect(code).toBe("42501");
  });

  it("treats a deactivated user as having no company", async () => {
    const rows = await asUser(a.users.admin, async (c) => {
      await c.query("update users set is_active = false where id = $1", [a.users.office]);
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: a.users.office, role: "authenticated" }),
      ]);
      return (await c.query("select id from contacts")).rows;
    });
    expect(rows).toHaveLength(0);
  });
});

describe("roles", () => {
  it.each(["installer", "subcontractor"] as const)(
    "%s cannot see CRM data yet (assigned jobs arrive in phase 5)",
    async (role) => {
      const counts = await asUser(a.users[role], async (c) => {
        const contacts = await c.query("select 1 from contacts");
        const projects = await c.query("select 1 from projects");
        const messages = await c.query("select 1 from messages");
        return [contacts.rowCount, projects.rowCount, messages.rowCount];
      });
      expect(counts).toEqual([0, 0, 0]);
    },
  );

  it("only admins can edit company settings", async () => {
    const officeCount = await asUser(a.users.office, async (c) =>
      (await c.query("update companies set name = 'Hacked' where id = $1", [a.companyId])).rowCount,
    );
    const adminCount = await asUser(a.users.admin, async (c) =>
      (await c.query("update companies set vat_number = 'GB123456789' where id = $1", [a.companyId])).rowCount,
    );
    expect(officeCount).toBe(0);
    expect(adminCount).toBe(1);
  });

  it("lets users edit their own name but not their role", async () => {
    const renamed = await asUser(a.users.installer, async (c) =>
      (await c.query("update users set full_name = 'Sam Fitter' where id = $1", [a.users.installer])).rowCount,
    );
    expect(renamed).toBe(1);

    const code = await errorCode(
      asUser(a.users.installer, (c) =>
        c.query("update users set role = 'admin' where id = $1", [a.users.installer]),
      ),
    );
    expect(code).toBe("42501");
  });

  it("lets admins change a colleague's role", async () => {
    const role = await asUser(a.users.admin, async (c) => {
      const { rows } = await c.query("update users set role = 'admin' where id = $1 returning role", [
        a.users.office,
      ]);
      return rows[0]?.role;
    });
    expect(role).toBe("admin");
  });

  it("only admins can delete contacts", async () => {
    const officeCount = await asUser(a.users.office, async (c) =>
      (await c.query("delete from contacts where id = $1", [a.contactId])).rowCount,
    );
    expect(officeCount).toBe(0);
  });

  it("only admins manage integrations", async () => {
    const code = await errorCode(
      asUser(a.users.office, (c) => c.query("insert into integrations (provider) values ('xero')")),
    );
    expect(code).toBe("42501");
  });
});

describe("messages", () => {
  it("staff can add notes and outbound messages", async () => {
    const n = await asUser(a.users.office, async (c) => {
      await c.query(
        "insert into messages (contact_id, channel, direction, body, sent_by) values ($1, 'note', 'internal', 'Called, no answer', $2)",
        [a.contactId, a.users.office],
      );
      return (await c.query("select 1 from messages where contact_id = $1", [a.contactId])).rowCount;
    });
    expect(n).toBe(1);
  });

  it("staff cannot forge inbound or system messages", async () => {
    for (const [channel, direction] of [
      ["email", "inbound"],
      ["system", "internal"],
    ]) {
      const code = await errorCode(
        asUser(a.users.office, (c) =>
          c.query("insert into messages (contact_id, channel, direction, body) values ($1, $2, $3, 'x')", [
            a.contactId,
            channel,
            direction,
          ]),
        ),
      );
      expect(code).toBe("42501");
    }
  });
});
