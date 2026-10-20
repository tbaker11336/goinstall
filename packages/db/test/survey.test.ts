import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSuperuser, asUser, errorCode, pool, seedCompany, type SeedCompany } from "./helpers";

let a: SeedCompany;
let b: SeedCompany;
let surveyA: string;
let surveyB: string;

beforeAll(async () => {
  a = await seedCompany("Survey");
  b = await seedCompany("Rival");
  [surveyA, surveyB] = await asSuperuser(async (c) => {
    const ids: [string, string] = ["", ""];
    for (const [i, s] of [a, b].entries()) {
      const { rows } = await c.query("insert into surveys (company_id, project_id) values ($1, $2) returning id", [s.companyId, s.projectId]);
      ids[i] = rows[0].id;
    }
    return ids;
  });
});

afterAll(() => pool.end());

describe("company defaults", () => {
  it("gives every new company survey questions, photo types and the survey email", async () => {
    const counts = await asUser(a.users.office, async (c) => {
      const q = await c.query("select count(*)::int n, count(*) filter (where 'ev' = any(products))::int ev from survey_questions");
      const p = await c.query("select count(*)::int n from photo_categories");
      const t = await c.query("select subject, body from message_templates where key = 'survey_link'");
      return { questions: q.rows[0], photos: p.rows[0].n, template: t.rows[0] };
    });
    expect(counts.questions.n).toBeGreaterThanOrEqual(10);
    expect(counts.questions.ev).toBeGreaterThan(0);
    expect(counts.photos).toBeGreaterThanOrEqual(5);
    expect(counts.template.body).toContain("{{survey_link}}");
  });
});

describe("survey RLS", () => {
  it("lets office staff see only their own company's surveys, questions and files", async () => {
    await asSuperuser((c) =>
      c.query(
        "insert into files (company_id, project_id, category, path, content_type, size_bytes, source) values ($1, $2, 'meter', $3, 'image/jpeg', 10, 'online_survey'), ($4, $5, 'meter', $6, 'image/jpeg', 10, 'online_survey')",
        [a.companyId, a.projectId, `${a.companyId}/x.jpg`, b.companyId, b.projectId, `${b.companyId}/x.jpg`],
      ),
    );
    const seen = await asUser(a.users.office, async (c) => ({
      surveys: (await c.query("select id from surveys")).rows.map((r) => r.id),
      files: (await c.query("select company_id from files")).rows.map((r) => r.company_id),
      questions: (await c.query("select distinct company_id from survey_questions")).rows.map((r) => r.company_id),
    }));
    expect(seen.surveys).toEqual([surveyA]);
    expect(new Set(seen.files)).toEqual(new Set([a.companyId]));
    expect(seen.questions).toEqual([a.companyId]);
  });

  it("hides survey data from installers and subcontractors until bookings arrive", async () => {
    for (const role of ["installer", "subcontractor"] as const) {
      const rows = await asUser(a.users[role], async (c) => (await c.query("select 1 from surveys union all select 1 from survey_fields union all select 1 from files")).rowCount);
      expect(rows).toBe(0);
    }
  });

  it("only lets admins change questions and templates", async () => {
    const office = await asUser(a.users.office, async (c) => (await c.query("update survey_questions set label = 'Changed' where key = 'roof_type'")).rowCount);
    expect(office).toBe(0);
    const admin = await asUser(a.users.admin, async (c) => (await c.query("update survey_questions set label = 'Changed' where key = 'roof_type'")).rowCount);
    expect(admin).toBe(1);
  });

  it("makes staff edits carry their own name and refuses customer-sourced writes", async () => {
    const asCustomer = asUser(a.users.office, (c) =>
      c.query("insert into survey_fields (survey_id, key, value, source) values ($1, 'roof_type', 'Pitched', 'online')", [surveyA]),
    );
    expect(await errorCode(asCustomer)).toBe("42501");
    const asSomeoneElse = asUser(a.users.office, (c) =>
      c.query("insert into survey_fields (survey_id, key, value, source, edited_by) values ($1, 'roof_type', 'Pitched', 'staff_edit', $2)", [surveyA, a.users.admin]),
    );
    expect(await errorCode(asSomeoneElse)).toBe("42501");
    const ok = await asUser(a.users.office, async (c) =>
      (await c.query("insert into survey_fields (survey_id, key, value, source, edited_by) values ($1, 'roof_type', 'Pitched', 'staff_edit', $2)", [surveyA, a.users.office])).rowCount,
    );
    expect(ok).toBe(1);
  });

  it("can't point a survey at another company's project", async () => {
    const err = await errorCode(asSuperuser((c) => c.query("insert into surveys (company_id, project_id) values ($1, $2)", [a.companyId, b.projectId])));
    expect(err).toBe("23503");
  });

  it("refuses staff file rows that claim to come from the customer", async () => {
    const err = await errorCode(
      asUser(a.users.office, (c) =>
        c.query("insert into files (project_id, path, content_type, size_bytes, source, uploaded_by) values ($1, 'p/forged.jpg', 'image/jpeg', 5, 'online_survey', $2)", [a.projectId, a.users.office]),
      ),
    );
    expect(err).toBe("42501");
  });
});

describe("survey field history", () => {
  it("keeps the overwritten value and its source", async () => {
    await asSuperuser((c) =>
      c.query("insert into survey_fields (company_id, survey_id, key, value, source) values ($1, $2, 'main_fuse', '60 A', 'online')", [b.companyId, surveyB]),
    );
    await asUser(
      b.users.office,
      (c) => c.query("update survey_fields set value = '100 A', source = 'staff_edit', edited_by = $1 where survey_id = $2 and key = 'main_fuse'", [b.users.office, surveyB]),
      { commit: true },
    );
    const history = await asUser(b.users.office, async (c) => (await c.query("select value, source from survey_field_history where survey_id = $1 and key = 'main_fuse'", [surveyB])).rows);
    expect(history).toEqual([{ value: "60 A", source: "online" }]);
    const err = await errorCode(asUser(b.users.admin, (c) => c.query("insert into survey_field_history (company_id, survey_id, key, source, set_at) values ($1, $2, 'x', 'online', now())", [b.companyId, surveyB])));
    expect(err).toBe("42501");
  });
});
