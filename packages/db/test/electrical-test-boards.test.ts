import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;
let bookingId: string;

beforeAll(async () => {
  a = await seedCompany("Tests");
  b = await seedCompany("Other tests");
  bookingId = await asSuperuser(async (c) => {
    const id = (await c.query("insert into bookings (company_id, project_id, type, starts_at, ends_at) values ($1, $2, 'install', '2026-11-02', '2026-11-03') returning id", [a.companyId, a.projectId])).rows[0].id;
    await c.query("insert into booking_assignments (company_id, booking_id, role, user_id) values ($1, $2, 'electrician', $3)", [a.companyId, id, a.users.installer]);
    return id;
  });
});
afterAll(() => pool.end());

const board = JSON.stringify({ db_ref: "DB1", zdb: "0.35" });
const circuits = JSON.stringify([{ ref: "1", designation: "Sockets", zs: "0.62" }]);

describe("electrical test boards", () => {
  it("the installer on the job records results; the office sees and edits them", async () => {
    const id = randomUUID();
    await asUser(a.users.installer, (c) => c.query("insert into electrical_test_boards (id, project_id, booking_id, board, circuits) values ($1, $2, $3, $4, $5)", [id, a.projectId, bookingId, board, circuits]), { commit: true });
    const rows = await asUser(a.users.office, (c) => c.query("select board->>'db_ref' as ref, jsonb_array_length(circuits) as n from electrical_test_boards"));
    expect(rows.rows).toEqual([{ ref: "DB1", n: 1 }]);
    await asUser(a.users.office, (c) => c.query("update electrical_test_boards set board = board || '{\"location\":\"Garage\"}' where id = $1", [id]), { commit: true });
    expect((await asUser(a.users.installer, (c) => c.query("select board->>'location' as l from electrical_test_boards"))).rows).toEqual([{ l: "Garage" }]);
  });

  it("is hidden from subcontractors, installers not on the job and other companies", async () => {
    expect((await asUser(a.users.subcontractor, (c) => c.query("select 1 from electrical_test_boards"))).rowCount).toBe(0);
    expect(await errorCode(asUser(a.users.subcontractor, (c) => c.query("insert into electrical_test_boards (id, project_id, booking_id) values ($1, $2, $3)", [randomUUID(), a.projectId, bookingId])))).toBe("42501");
    // An installer can't add results without a job they're on.
    expect(await errorCode(asUser(a.users.installer, (c) => c.query("insert into electrical_test_boards (id, project_id) values ($1, $2)", [randomUUID(), a.projectId])))).toBe("42501");
    expect((await asUser(b.users.admin, (c) => c.query("select 1 from electrical_test_boards"))).rowCount).toBe(0);
    // Another company's project can't be named.
    expect(await errorCode(asUser(b.users.office, (c) => c.query("insert into electrical_test_boards (id, project_id) values ($1, $2)", [randomUUID(), a.projectId])))).toBe("23503");
  });

  it("caps a board at 100 circuits", async () => {
    const many = JSON.stringify(Array.from({ length: 101 }, (_, i) => ({ ref: String(i + 1) })));
    expect(await errorCode(asUser(a.users.office, (c) => c.query("insert into electrical_test_boards (id, project_id, circuits) values ($1, $2, $3)", [randomUUID(), a.projectId, many])))).toBe("23514");
  });
});
