import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;

beforeAll(async () => {
  a = await seedCompany("Stages");
});

afterAll(() => pool.end());

async function newProject(stage = "enquiry") {
  return asSuperuser(async (c) => {
    const { rows } = await c.query(
      "insert into projects (company_id, contact_id, stage) values ($1, $2, $3) returning id",
      [a.companyId, a.contactId, stage],
    );
    return rows[0].id as string;
  });
}

describe("project stages", () => {
  it("logs project creation", async () => {
    const id = await newProject();
    const events = await asUser(a.users.office, async (c) =>
      (await c.query("select event from activity_log where project_id = $1", [id])).rows,
    );
    expect(events).toEqual([{ event: "project_created" }]);
  });

  it("logs every stage change with the actor", async () => {
    const id = await newProject();
    const log = await asUser(a.users.office, async (c) => {
      await c.query("update projects set stage = 'survey' where id = $1", [id]);
      await c.query("update projects set stage = 'design' where id = $1", [id]);
      await c.query("update projects set stage = 'survey' where id = $1", [id]);
      const { rows } = await c.query(
        "select actor_id, payload from activity_log where project_id = $1 and event = 'stage_changed' order by created_at",
        [id],
      );
      return rows;
    });
    expect(log.map((r) => [r.payload.from, r.payload.to])).toEqual([
      ["enquiry", "survey"],
      ["survey", "design"],
      ["design", "survey"],
    ]);
    expect(log.every((r) => r.actor_id === a.users.office)).toBe(true);
  });

  it("requires a reason to mark a project lost", async () => {
    const id = await newProject("survey");
    const code = await errorCode(
      asUser(a.users.office, (c) => c.query("update projects set stage = 'lost' where id = $1", [id])),
    );
    expect(code).toBe("23514");
  });

  it("records the stage a project was lost from and clears it on reopen", async () => {
    const id = await newProject("proposal_sent");
    const [lost, reopened] = await asUser(a.users.office, async (c) => {
      const lost = await c.query(
        "update projects set stage = 'lost', lost_reason = 'Went with competitor' where id = $1 returning lost_from_stage",
        [id],
      );
      const reopened = await c.query(
        "update projects set stage = 'proposal_sent' where id = $1 returning lost_from_stage, lost_reason",
        [id],
      );
      return [lost.rows[0], reopened.rows[0]];
    });
    expect(lost.lost_from_stage).toBe("proposal_sent");
    expect(reopened).toEqual({ lost_from_stage: null, lost_reason: null });
  });

  it.each(["deposit_paid", "kit_ordered", "scheduled", "complete"])(
    "cannot mark a project lost from %s",
    async (stage) => {
      const id = await newProject(stage);
      const code = await errorCode(
        asUser(a.users.office, (c) =>
          c.query("update projects set stage = 'lost', lost_reason = 'Changed mind' where id = $1", [id]),
        ),
      );
      expect(code).toBe("23514");
    },
  );

  it("keeps the activity log append-only for staff", async () => {
    const id = await newProject();
    const counts = await asUser(a.users.admin, async (c) => {
      const u = await c.query("update activity_log set event = 'edited' where project_id = $1", [id]);
      const d = await c.query("delete from activity_log where project_id = $1", [id]);
      return [u.rowCount, d.rowCount];
    });
    expect(counts).toEqual([0, 0]);
  });

  it("does not let staff log activity as someone else", async () => {
    const code = await errorCode(
      asUser(a.users.office, (c) =>
        c.query("insert into activity_log (project_id, actor_id, event) values ($1, $2, 'note')", [
          a.projectId,
          a.users.admin,
        ]),
      ),
    );
    expect(code).toBe("42501");
  });
});

describe("contact stages", () => {
  it("requires a reason to mark a contact lost and logs the change", async () => {
    const code = await errorCode(
      asUser(a.users.office, (c) => c.query("update contacts set stage = 'lost' where id = $1", [a.contactId])),
    );
    expect(code).toBe("23514");

    const payload = await asUser(a.users.office, async (c) => {
      await c.query("update contacts set stage = 'lost', lost_reason = 'Price' where id = $1", [a.contactId]);
      const { rows } = await c.query(
        "select payload from activity_log where contact_id = $1 and event = 'contact_stage_changed'",
        [a.contactId],
      );
      return rows[0]?.payload;
    });
    expect(payload).toEqual({ from: "new_enquiry", to: "lost", lost_reason: "Price" });
  });
});
