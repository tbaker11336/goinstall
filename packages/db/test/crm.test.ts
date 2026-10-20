import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Crm");
  b = await seedCompany("Other");
});

afterAll(() => pool.end());

/** A fresh contact with projects at the given stages. */
async function contactWith(...stages: string[]) {
  return asSuperuser(async (c) => {
    const {
      rows: [contact],
    } = await c.query("insert into contacts (company_id, name) values ($1, $2) returning id", [
      a.companyId,
      `Customer ${randomUUID().slice(0, 6)}`,
    ]);
    const projectIds: string[] = [];
    for (const stage of stages) {
      const { rows } = await c.query(
        "insert into projects (company_id, contact_id, stage, lost_reason) values ($1, $2, $3, $4) returning id",
        [a.companyId, contact.id, stage, stage === "lost" ? "Old reason" : null],
      );
      projectIds.push(rows[0].id);
    }
    return { contactId: contact.id as string, projectIds };
  });
}

async function stageOf(table: "contacts" | "projects", id: string) {
  return asSuperuser(async (c) => {
    const { rows } = await c.query(`select stage, lost_reason from ${table} where id = $1`, [id]);
    return rows[0] as { stage: string; lost_reason: string | null };
  });
}

describe("contact stage follows projects", () => {
  it("uses the furthest open project", async () => {
    const { contactId, projectIds } = await contactWith("survey", "lost");
    expect((await stageOf("contacts", contactId)).stage).toBe("survey");

    await asUser(a.users.office, (c) => c.query("update projects set stage = 'accepted' where id = $1", [projectIds[0]]), {
      commit: true,
    });
    expect((await stageOf("contacts", contactId)).stage).toBe("proposal_sent");

    await asUser(a.users.office, (c) => c.query("update projects set stage = 'scheduled' where id = $1", [projectIds[0]]), {
      commit: true,
    });
    expect((await stageOf("contacts", contactId)).stage).toBe("won");
  });

  it("is lost with the latest reason only when every project is lost", async () => {
    const { contactId, projectIds } = await contactWith("design");
    await asUser(
      a.users.office,
      (c) => c.query("update projects set stage = 'lost', lost_reason = 'Too expensive' where id = $1", [projectIds[0]]),
      { commit: true },
    );
    expect(await stageOf("contacts", contactId)).toEqual({ stage: "lost", lost_reason: "Too expensive" });
  });
});

describe("set_contact_stage (Kanban move)", () => {
  const move = (userId: string, contactId: string, stage: string, reason?: string) =>
    asUser(
      userId,
      async (c) => (await c.query("select set_contact_stage($1, $2, $3) as stage", [contactId, stage, reason ?? null])).rows[0].stage,
      { commit: true },
    );

  it("moves the main project and the contact follows", async () => {
    const { contactId, projectIds } = await contactWith("enquiry");
    expect(await move(a.users.office, contactId, "design")).toBe("design");
    expect((await stageOf("projects", projectIds[0]!)).stage).toBe("design");
  });

  it("moves a contact with no projects directly", async () => {
    const { contactId } = await contactWith();
    expect(await move(a.users.office, contactId, "survey")).toBe("survey");
  });

  it("marks every open project lost, with a reason", async () => {
    const { contactId, projectIds } = await contactWith("survey", "proposal_sent");
    expect(await errorCode(move(a.users.office, contactId, "lost"))).toBe("23514");

    expect(await move(a.users.office, contactId, "lost", "No longer interested")).toBe("lost");
    for (const id of projectIds) {
      expect(await stageOf("projects", id)).toEqual({ stage: "lost", lost_reason: "No longer interested" });
    }
    expect((await stageOf("contacts", contactId)).lost_reason).toBe("No longer interested");
  });

  it("refuses lost when a project is past deposit", async () => {
    const { contactId } = await contactWith("survey", "kit_ordered");
    expect(await errorCode(move(a.users.office, contactId, "lost", "Cancelled"))).toBe("23514");
  });

  it("reopens the most recently lost project", async () => {
    const { contactId, projectIds } = await contactWith("lost");
    expect(await move(a.users.office, contactId, "proposal_sent")).toBe("proposal_sent");
    expect(await stageOf("projects", projectIds[0]!)).toEqual({ stage: "proposal_sent", lost_reason: null });
    expect((await stageOf("contacts", contactId)).lost_reason).toBeNull();
  });

  it("cannot move another company's contact", async () => {
    expect(await errorCode(move(b.users.office, a.contactId, "design"))).toBe("P0002");
  });

  it("is not available to installers or anonymous callers", async () => {
    const { contactId } = await contactWith("enquiry");
    expect(await errorCode(move(a.users.installer, contactId, "survey"))).toBe("P0002");
    expect(
      await errorCode(asUser(null, (c) => c.query("select set_contact_stage($1, 'survey')", [contactId]))),
    ).toBe("42501");
  });
});

describe("last activity", () => {
  it("is bumped by new messages", async () => {
    const { contactId } = await contactWith();
    const [before, after] = await asUser(a.users.office, async (c) => {
      await c.query("update contacts set last_activity_at = now() - interval '1 day' where id = $1", [contactId]);
      const before = (await c.query("select last_activity_at from contacts where id = $1", [contactId])).rows[0];
      await c.query("insert into messages (contact_id, channel, direction, body) values ($1, 'note', 'internal', 'Hi')", [
        contactId,
      ]);
      const after = (await c.query("select last_activity_at from contacts where id = $1", [contactId])).rows[0];
      return [before.last_activity_at as Date, after.last_activity_at as Date];
    });
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});
