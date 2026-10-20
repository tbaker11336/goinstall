import "server-only";
import { paperworkFor, parseAmps, type PaperworkContext, type PaperworkInput, type Specs } from "@goinstall/core";
import type { Tx } from "@goinstall/db";
import { surveyAnswers } from "./survey";

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Everything the paperwork rules and pre-filled values read, for one project. */
/** Runs as staff or as the service role (job completion in the app), so every query names the company. */
export async function paperworkData(tx: Tx, companyId: string, projectId: string): Promise<{ input: PaperworkInput; context: PaperworkContext } | null> {
  const project = await tx
    .selectFrom("projects as p")
    .innerJoin("contacts as c", "c.id", "p.contact_id")
    .select(["p.id", "p.mpan", "p.site_address_line1", "p.site_address_line2", "p.site_town", "p.site_postcode", "c.name as contact_name", "c.phone as contact_phone", "c.email as contact_email"])
    .where("p.id", "=", projectId)
    .where("p.company_id", "=", companyId)
    .executeTakeFirst();
  if (!project) return null;
  const [company, solar, ev, answers, install, checks] = await Promise.all([
    tx.selectFrom("companies").select(["name", "address_line1", "address_line2", "town", "postcode", "phone", "email", "mcs_number", "competent_person_scheme_number"]).where("id", "=", companyId).executeTakeFirstOrThrow(),
    tx.selectFrom("solar_designs").selectAll().where("company_id", "=", companyId).where("project_id", "=", projectId).where("is_active", "=", true).executeTakeFirst(),
    tx.selectFrom("ev_designs").selectAll().where("company_id", "=", companyId).where("project_id", "=", projectId).where("is_active", "=", true).executeTakeFirst(),
    surveyAnswers(tx, projectId, companyId),
    tx
      .selectFrom("bookings")
      .select(["starts_at", "started_at", "completed_at"])
      .where("company_id", "=", companyId)
      .where("project_id", "=", projectId)
      .where("type", "=", "install")
      .where("status", "!=", "cancelled")
      .orderBy("starts_at")
      .execute(),
    tx
      .selectFrom("checklist_items as i")
      .innerJoin("bookings as b", "b.id", "i.booking_id")
      .leftJoin("checklist_templates as t", "t.id", "i.template_id")
      .select(["i.title", "i.product", "i.serial", "i.readings", "t.readings as reading_labels"])
      .where("i.company_id", "=", companyId)
      .where("i.project_id", "=", projectId)
      .where("b.type", "=", "install")
      .where("b.status", "!=", "cancelled")
      .orderBy("t.position")
      .execute(),
  ]);

  const ids = [solar?.panel_product_id, solar?.inverter_product_id, solar?.battery_product_id, ev?.charger_product_id].filter((x): x is string => Boolean(x));
  const products = ids.length ? await tx.selectFrom("products").select(["id", "name", "make", "model", "specs"]).where("company_id", "=", companyId).where("id", "in", ids).execute() : [];
  const product = (id: string | null | undefined) => {
    const p = products.find((x) => x.id === id);
    return p ? { ...p, specs: (p.specs ?? {}) as Specs } : null;
  };
  const panel = product(solar?.panel_product_id);
  const inverter = product(solar?.inverter_product_id);
  const battery = solar?.battery_count ? product(solar.battery_product_id) : null;
  const charger = product(ev?.charger_product_id);

  const completed = install.filter((b) => b.completed_at).map((b) => b.completed_at!);
  const commissionedAt = completed.length ? new Date(Math.max(...completed.map((d) => d.getTime()))) : null;
  const installedAt = install[0]?.started_at ?? install[0]?.starts_at ?? null;
  const phases: 1 | 3 | null = ev?.phases === 3 || /three/i.test(answers.supply_phase ?? "") ? 3 : ev?.phases === 1 || answers.supply_phase ? 1 : null;

  const input: PaperworkInput = {
    solar: solar ? { connectionForm: (solar.connection_form as "G98" | "G99" | null) ?? null } : null,
    ev: Boolean(ev),
    hasInstall: install.length > 0,
    installStart: install[0]?.starts_at ?? null,
    commissionedAt,
    warranties: [panel, inverter, battery, charger].filter((p): p is NonNullable<typeof p> => Boolean(p)).map((p) => ({ productId: p.id, name: p.name })),
  };

  const context: PaperworkContext = {
    company: {
      name: company.name,
      address: [company.address_line1, company.address_line2, company.town, company.postcode].filter(Boolean).join(", ") || null,
      phone: company.phone,
      email: company.email,
      mcsNumber: company.mcs_number,
      competentPersonScheme: company.competent_person_scheme_number,
    },
    customer: { name: project.contact_name, phone: project.contact_phone, email: project.contact_email },
    site: { address: [project.site_address_line1, project.site_address_line2, project.site_town].filter(Boolean).join(", "), postcode: project.site_postcode, mpan: project.mpan },
    supply: { phases, mainFuseA: ev?.main_fuse_a ?? parseAmps(answers.main_fuse ?? null), earthing: ev?.earthing ?? str(answers.earthing) },
    solar: solar
      ? {
          panel: panel ? { make: panel.make, model: panel.model, count: solar.panel_count } : null,
          kWp: Number(solar.kwp),
          inverter: inverter ? { make: inverter.make, model: inverter.model, acKw: num(inverter.specs.ac_kw), phases: num(inverter.specs.phases), enaRef: str(inverter.specs.ena_type_test_ref) } : null,
          battery: battery
            ? { make: battery.make, model: battery.model, usableKwh: num(battery.specs.usable_kwh ?? battery.specs.capacity_kwh), powerKw: num(battery.specs.power_kw), count: solar.battery_count, enaRef: str(battery.specs.ena_type_test_ref) }
            : null,
          exportKw: num(solar.export_kw),
          annualKwh: solar.annual_kwh_mcs,
          mcsZone: solar.mcs_zone,
        }
      : null,
    ev: ev
      ? {
          make: charger?.make ?? null,
          model: charger?.model ?? "Charger not chosen",
          ratedKw: num(charger?.specs.rated_kw),
          ratedA: num(charger?.specs.rated_a),
          phases: num(charger?.specs.phases),
          enaRef: str(charger?.specs.ena_type_test_ref),
          maxDemandA: num(ev.max_demand_a),
          loadManagement: ev.load_management,
          cableMm2: num(ev.cable_size_mm2),
          protection: ev.protection,
        }
      : null,
    installedAt,
    commissionedAt,
    readings: checks.flatMap((c) => {
      const labels = (c.reading_labels ?? []) as { key: string; label: string; unit?: string }[];
      const values = (c.readings ?? {}) as Record<string, string>;
      const rows = labels.length ? labels.map((l) => ({ label: l.label, value: str(values[l.key]) ?? "", unit: l.unit ?? null })) : Object.entries(values).map(([k, v]) => ({ label: k, value: String(v), unit: null }));
      return rows.length ? [{ step: c.title, product: c.product, values: rows }] : [];
    }),
    serials: checks.flatMap((c) => (c.serial ? [{ step: c.title, product: c.product, serial: c.serial }] : [])),
  };
  return { input, context };
}

/**
 * Bring a project's paperwork list in line with its design and install:
 * add items that now apply, keep due dates following the rules until staff
 * set their own, and drop untouched items that no longer apply (e.g. a G98
 * notification once the design needs G99). Started items are never removed.
 */
export async function syncPaperwork(tx: Tx, companyId: string, projectId: string): Promise<void> {
  const data = await paperworkData(tx, companyId, projectId);
  if (!data) return;
  const plan = paperworkFor(data.input);
  const existing = await tx
    .selectFrom("paperwork_items as w")
    .select(["w.id", "w.kind", "w.product_id", "w.status", "w.due_auto", (eb) => eb.exists(eb.selectFrom("files").select("id").whereRef("files.paperwork_item_id", "=", "w.id").where("files.deleted_at", "is", null)).as("has_files")])
    .where("w.company_id", "=", companyId)
    .where("w.project_id", "=", projectId)
    .execute();
  const key = (kind: string, productId: string | null) => `${kind}|${productId ?? ""}`;
  const planned = new Map(plan.map((p) => [key(p.kind, p.productId), p]));
  for (const p of plan) {
    const e = existing.find((x) => key(x.kind, x.product_id) === key(p.kind, p.productId));
    if (!e) {
      await tx
        .insertInto("paperwork_items")
        .values({ company_id: companyId, project_id: projectId, kind: p.kind, product_id: p.productId, title: p.title, timing: p.timing, due_date: p.dueDate, due_note: p.dueNote })
        .onConflict((oc) => oc.doNothing())
        .execute();
    } else if (e.due_auto) {
      await tx.updateTable("paperwork_items").set({ title: p.title, timing: p.timing, due_date: p.dueDate, due_note: p.dueNote }).where("company_id", "=", companyId).where("id", "=", e.id).execute();
    }
  }
  const stale = existing.filter((e) => !planned.has(key(e.kind, e.product_id)) && e.status === "to_do" && !e.has_files).map((e) => e.id);
  if (stale.length) await tx.deleteFrom("paperwork_items").where("company_id", "=", companyId).where("id", "in", stale).execute();
}
