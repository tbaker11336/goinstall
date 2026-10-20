import "server-only";
import type { ChecklistStep, ReadingField } from "@goinstall/core";
import type { Tx } from "@goinstall/db";
import type { Session } from "./auth";

/**
 * Everything the installer app needs to work a job offline: the booking,
 * site and customer, design summary, kit (no prices), survey questions and
 * answers, checklist steps and what's been captured so far.
 */
export async function jobsFor(tx: Tx, session: Session, range: { from: Date; to: Date }) {
  const me = await tx.selectFrom("users").select("team_id").where("id", "=", session.userId).executeTakeFirstOrThrow();
  const bookings = await tx
    .selectFrom("bookings as b")
    .innerJoin("booking_assignments as a", (j) => j.onRef("a.booking_id", "=", "b.id").onRef("a.company_id", "=", "b.company_id"))
    .leftJoin("projects as p", (j) => j.onRef("p.id", "=", "b.project_id").onRef("p.company_id", "=", "b.company_id"))
    .leftJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
    .select([
      "b.id",
      "b.project_id",
      "b.type",
      "b.status",
      "b.title",
      "b.starts_at",
      "b.ends_at",
      "b.all_day",
      "b.notes",
      "b.started_at",
      "b.completed_at",
      "b.signoff_name",
      "a.role",
      "p.site_address_line1",
      "p.site_address_line2",
      "p.site_town",
      "p.site_postcode",
      "p.lat",
      "p.lng",
      "p.products",
      "c.name as contact_name",
      "c.phone as contact_phone",
    ])
    .where("b.status", "!=", "cancelled")
    .where("b.ends_at", ">", range.from)
    .where("b.starts_at", "<", range.to)
    .where((eb) => eb.or([eb("a.user_id", "=", session.userId), ...(me.team_id ? [eb("a.team_id", "=", me.team_id)] : [])]))
    .orderBy("b.starts_at")
    .execute();
  const unique = [...new Map(bookings.map((b) => [b.id, b])).values()];
  const projectIds = [...new Set(unique.flatMap((b) => (b.project_id ? [b.project_id] : [])))];
  const bookingIds = unique.map((b) => b.id);

  const [kit, surveys, solar, ev, items, templates, questions, categories] = await Promise.all([
    projectIds.length ? tx.selectFrom("kit_items").select(["id", "project_id", "description", "quantity", "issue", "issue_note"]).where("project_id", "in", projectIds).orderBy("position").execute() : [],
    projectIds.length ? tx.selectFrom("surveys").select(["id", "project_id", "kind"]).where("project_id", "in", projectIds).execute() : [],
    projectIds.length ? tx.selectFrom("solar_designs").select(["project_id", "panel_count", "kwp", "segments", "battery_count", "connection_form"]).where("project_id", "in", projectIds).where("is_active", "=", true).execute() : [],
    session.role !== "subcontractor" && projectIds.length
      ? tx.selectFrom("ev_designs").select(["project_id", "route_length_m", "cable_size_mm2", "route"]).where("project_id", "in", projectIds).where("is_active", "=", true).execute()
      : [],
    bookingIds.length ? tx.selectFrom("checklist_items").selectAll().where("booking_id", "in", bookingIds).execute() : [],
    tx.selectFrom("checklist_templates").selectAll().where("archived_at", "is", null).orderBy("position").execute(),
    tx.selectFrom("survey_questions").select(["survey_kind", "key", "label", "help", "type", "options", "products", "section", "position", "required"]).where("archived_at", "is", null).orderBy("position").execute(),
    tx.selectFrom("photo_categories").select(["survey_kind", "key", "label", "products", "required", "position"]).where("archived_at", "is", null).orderBy("position").execute(),
  ]);
  const surveyIds = surveys.map((s) => s.id);
  const fields = surveyIds.length ? await tx.selectFrom("survey_fields").select(["survey_id", "key", "value", "source", "updated_at"]).where("survey_id", "in", surveyIds).execute() : [];

  const steps: ChecklistStep[] = templates.map((t) => ({
    id: t.id,
    kind: t.kind as ChecklistStep["kind"],
    product: t.product as ChecklistStep["product"],
    title: t.title,
    help: t.help,
    position: t.position,
    requiresPhoto: t.requires_photo,
    requiresSerial: t.requires_serial,
    readings: (t.readings ?? []) as unknown as ReadingField[],
  }));

  return {
    serverTime: new Date().toISOString(),
    user: { id: session.userId, name: session.fullName, role: session.role, companyName: session.companyName },
    checklist: steps,
    surveyQuestions: questions,
    photoCategories: categories,
    jobs: unique.map((b) => {
      const projectSurveys = surveys.filter((s) => s.project_id === b.project_id);
      const s = solar.find((x) => x.project_id === b.project_id);
      const e = ev.find((x) => x.project_id === b.project_id);
      return {
        id: b.id,
        projectId: b.project_id,
        type: b.type,
        role: b.role,
        status: b.status,
        title: b.title,
        startsAt: b.starts_at,
        endsAt: b.ends_at,
        allDay: b.all_day,
        notes: b.notes,
        startedAt: b.started_at,
        completedAt: b.completed_at,
        signoffName: b.signoff_name,
        address: [b.site_address_line1, b.site_address_line2, b.site_town, b.site_postcode].filter(Boolean).join(", "),
        postcode: b.site_postcode,
        lat: b.lat,
        lng: b.lng,
        products: b.products ?? [],
        customer: b.contact_name ? { name: b.contact_name, phone: b.contact_phone } : null,
        design: {
          solar: s ? { panelCount: s.panel_count, kWp: Number(s.kwp), batteryCount: s.battery_count, connectionForm: s.connection_form, segments: s.segments } : null,
          ev: e ? { routeLengthM: e.route_length_m === null ? null : Number(e.route_length_m), cableSizeMm2: e.cable_size_mm2 === null ? null : Number(e.cable_size_mm2), route: e.route } : null,
        },
        kit: kit.filter((k) => k.project_id === b.project_id).map((k) => ({ id: k.id, description: k.description, quantity: Number(k.quantity), issue: k.issue, issueNote: k.issue_note })),
        surveys: projectSurveys.map((sv) => ({ id: sv.id, kind: sv.kind, fields: Object.fromEntries(fields.filter((f) => f.survey_id === sv.id).map((f) => [f.key, { value: f.value, source: f.source, updatedAt: f.updated_at }])) })),
        captured: items
          .filter((i) => i.booking_id === b.id)
          .map((i) => ({ id: i.id, templateId: i.template_id, done: i.done, serial: i.serial, readings: i.readings, note: i.note, photoFileIds: i.photo_file_ids, capturedAt: i.captured_at })),
      };
    }),
  };
}

export type AppBundle = Awaited<ReturnType<typeof jobsFor>>;
