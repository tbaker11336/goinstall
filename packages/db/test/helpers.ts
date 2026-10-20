import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

export const pool = new pg.Pool({ connectionString: inject("testDatabaseUrl"), max: 4 });

type Role = "admin" | "office" | "installer" | "subcontractor";

/** Run queries as the service role / migration owner (bypasses RLS). */
export async function asSuperuser<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Run queries the way PostgREST does for a logged-in user: inside a
 * transaction, as the `authenticated` role, with the JWT claims set.
 * Rolls back unless `commit` is true, so tests don't leak changes.
 */
export async function asUser<T>(
  userId: string | null,
  fn: (c: pg.PoolClient) => Promise<T>,
  { commit = false } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
    if (userId) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
    }
    const result = await fn(client);
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export interface SeedCompany {
  companyId: string;
  users: Record<Role, string>;
  contactId: string;
  projectId: string;
}

/** Create a company with one user per role, a contact and a project. */
export async function seedCompany(name: string): Promise<SeedCompany> {
  return asSuperuser(async (c) => {
    const {
      rows: [company],
    } = await c.query("insert into companies (name) values ($1) returning id", [name]);
    const users = {} as Record<Role, string>;
    for (const role of ["admin", "office", "installer", "subcontractor"] as const) {
      const id = randomUUID();
      const email = `${role}.${id.slice(0, 8)}@example.test`;
      await c.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
      await c.query(
        "insert into users (id, company_id, full_name, email, role) values ($1, $2, $3, $4, $5)",
        [id, company.id, `${name} ${role}`, email, role],
      );
      users[role] = id;
    }
    const {
      rows: [contact],
    } = await c.query(
      "insert into contacts (company_id, name, email, postcode) values ($1, $2, $3, 'BS1 4DJ') returning id",
      [company.id, `${name} customer`, `customer@${name.toLowerCase()}.test`],
    );
    const {
      rows: [project],
    } = await c.query(
      "insert into projects (company_id, contact_id, products) values ($1, $2, '{solar,ev}') returning id",
      [company.id, contact.id],
    );
    return { companyId: company.id, users, contactId: contact.id, projectId: project.id };
  });
}

/** Expect a query to fail with the given Postgres error code. */
export async function errorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}
