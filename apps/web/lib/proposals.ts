import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { buildLinesFromDesigns, financeForSummary, type CatalogueItem, type ProductCategory, type ProposalSummary, type SummaryArray, type SummaryProduct, type VatRates } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";
import type { ProposalView } from "@/components/proposal-document";
import { loadEnergy } from "./energy";
import { signedUrls } from "./files";
import { env } from "./env";

/** Secret for proposal links. A dedicated one if set; else the service key (server-only either way). */
export function linkSecret() {
  const s = process.env.LINK_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.DEV_AUTH_SECRET;
  if (!s) throw new Error("Set LINK_SIGNING_SECRET to create proposal links");
  return s;
}

export const PROPOSAL_LINK_DAYS = 90;

export function proposalToken(proposalId: string, nonce: string) {
  return createHmac("sha256", linkSecret()).update(`proposal:${proposalId}:${nonce}`).digest("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newLinkNonce() {
  return randomBytes(16).toString("base64url");
}

export function proposalUrl(token: string) {
  return `${env.siteUrl.replace(/\/$/, "")}/p/${token}`;
}

/** Everything a proposal is built from: active designs, catalogue items and company settings. */
export async function designInputs(tx: Tx, projectId: string) {
  const [solar, ev, company] = await Promise.all([
    tx.selectFrom("solar_designs").selectAll().where("project_id", "=", projectId).where("is_active", "=", true).executeTakeFirst(),
    tx.selectFrom("ev_designs").selectAll().where("project_id", "=", projectId).where("is_active", "=", true).executeTakeFirst(),
    tx
      .selectFrom("companies")
      .select(["id", "name", "vat_rates", "shared_visit_discount_pence", "default_deposit_pct", "proposal_valid_days", "terms_and_conditions", "terms_file_id", "document_prefix"])
      .executeTakeFirstOrThrow(),
  ]);
  const ids = [solar?.panel_product_id, solar?.inverter_product_id, solar?.battery_product_id, ev?.charger_product_id].filter((x): x is string => Boolean(x));
  const products = ids.length ? await tx.selectFrom("products").select(["id", "name", "category", "sell_price_pence"]).where("id", "in", ids).execute() : [];
  const item = (id: string | null | undefined): CatalogueItem | null => {
    const p = products.find((x) => x.id === id);
    return p ? { id: p.id, name: p.name, category: p.category as ProductCategory, sellPence: p.sell_price_pence === null ? null : Number(p.sell_price_pence) } : null;
  };
  const built = buildLinesFromDesigns({
    solar: solar && solar.panel_count > 0 ? { panel: item(solar.panel_product_id), panelCount: solar.panel_count, kWp: Number(solar.kwp), inverter: item(solar.inverter_product_id), battery: item(solar.battery_product_id), batteryCount: solar.battery_count } : null,
    ev: ev?.charger_product_id ? { charger: item(ev.charger_product_id), routeLengthM: ev.route_length_m === null ? null : Number(ev.route_length_m) } : null,
    vatRates: (company.vat_rates ?? {}) as VatRates,
    sharedVisitDiscountPence: company.shared_visit_discount_pence === null ? null : Number(company.shared_visit_discount_pence),
  });
  const full = ids.length ? await tx.selectFrom("products").select(["id", "name", "make", "model", "category", "specs"]).where("id", "in", ids).execute() : [];
  const productOf = (id: string | null | undefined, role: SummaryProduct["role"], count: number): SummaryProduct[] => {
    const p = full.find((x) => x.id === id);
    return p && count > 0 ? [{ role, count, name: p.name, make: p.make, model: p.model, specs: (p.specs ?? {}) as SummaryProduct["specs"] }] : [];
  };
  const panelSpecs = (full.find((x) => x.id === solar?.panel_product_id)?.specs ?? {}) as Record<string, number>;
  const batterySpecs = (full.find((x) => x.id === solar?.battery_product_id)?.specs ?? {}) as Record<string, number>;
  const energy = await loadEnergy(tx, projectId);
  const selfUse = solar?.self_consumption_with_battery ?? solar?.self_consumption ?? null;
  const summary: ProposalSummary = {
    kWp: solar ? Number(solar.kwp) : null,
    panelCount: solar?.panel_count ?? null,
    annualKwh: solar?.annual_kwh_mcs ?? null,
    selfUse: selfUse === null ? null : Number(selfUse),
    yearlySavingPence: null,
    evRouteM: ev?.route_length_m === null || ev?.route_length_m === undefined ? null : Number(ev.route_length_m),
    segments: solar ? (solar.segments as unknown[]) : [],
    details: solar
      ? {
          zone: solar.mcs_zone,
          arrays: (solar.mcs_arrays ?? []) as unknown as SummaryArray[],
          selfUsePvOnly: solar.self_consumption === null ? null : Number(solar.self_consumption),
          selfUseWithBattery: solar.self_consumption_with_battery === null ? null : Number(solar.self_consumption_with_battery),
          batteryUsableKwh: solar.battery_count ? Number(batterySpecs.usable_kwh ?? batterySpecs.capacity_kwh ?? 0) * solar.battery_count || null : null,
          pvgisMonthly: solar.pvgis_monthly,
          googleKwh: solar.google_yearly_kwh,
          imageryDate: solar.imagery_date ? solar.imagery_date.toISOString().slice(0, 10) : null,
          products: [
            ...productOf(solar.panel_product_id, "panel", solar.panel_count),
            ...productOf(solar.inverter_product_id, "inverter", 1),
            ...productOf(solar.battery_product_id, "battery", solar.battery_count),
            ...productOf(ev?.charger_product_id, "ev_charger", 1),
          ],
        }
      : undefined,
    energy: { annualKwh: energy.annualKwh, monthlyKwh: energy.monthlyKwh, consumption: energy.consumption, tariff: energy.tariff, tariffName: energy.tariffName, source: energy.source },
    // A panel's datasheet degradation wins over the company default.
    assumptions: {
      ...energy.finance,
      ...(typeof panelSpecs.degradation_first_year_pct === "number" ? { degradationFirstYearPct: panelSpecs.degradation_first_year_pct } : {}),
      ...(typeof panelSpecs.degradation_annual_pct === "number" ? { degradationAnnualPct: panelSpecs.degradation_annual_pct } : {}),
    },
    emissions: energy.gridEmissions,
    layout: null,
  };
  if (summary.annualKwh && summary.selfUse !== null && energy.unitRatePence !== null && energy.exportRatePence !== null) {
    summary.yearlySavingPence = Math.round(summary.annualKwh * (summary.selfUse * energy.unitRatePence + (1 - summary.selfUse) * energy.exportRatePence));
  }
  return { solar, ev, company, built, summary };
}

export interface PublicProposal {
  id: string;
  companyId: string;
  projectId: string;
  contactId: string;
  status: string;
  number: number;
  version: number;
  ownerId: string | null;
  contactName: string;
  contactEmail: string | null;
}

/** Proposal by public token, with the facts the public page and its actions need. */
export async function findPublicProposal(tx: Tx, token: string): Promise<PublicProposal | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await tx
    .selectFrom("proposals as pr")
    .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "pr.project_id").onRef("p.company_id", "=", "pr.company_id"))
    .innerJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
    .select(["pr.id", "pr.company_id", "pr.project_id", "pr.status", "pr.number", "pr.version", "p.owner_id", "c.id as contact_id", "c.name as contact_name", "c.email as contact_email"])
    .where("pr.token_hash", "=", hashToken(token))
    .where("pr.token_expires_at", ">", sql<Date>`now()`)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    contactId: row.contact_id,
    status: row.status,
    number: row.number,
    version: row.version,
    ownerId: row.owner_id,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
  };
}

/** Full proposal content for display (console preview, public page and PDF). */
export async function proposalContent(tx: Tx, proposalId: string, companyId?: string) {
  let pq = tx
    .selectFrom("proposals as pr")
    .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "pr.project_id").onRef("p.company_id", "=", "pr.company_id"))
    .innerJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
    .innerJoin("companies as co", "co.id", "pr.company_id")
    .leftJoin("files as tf", (j) => j.onRef("tf.id", "=", "pr.terms_file_id").onRef("tf.company_id", "=", "pr.company_id"))
    .select([
      "tf.path as terms_file_path",
      "tf.original_name as terms_file_name",
      "pr.id",
      "pr.number",
      "pr.version",
      "pr.status",
      "pr.title",
      "pr.intro",
      "pr.summary",
      "pr.subtotal_pence",
      "pr.vat_pence",
      "pr.total_pence",
      "pr.deposit_pct",
      "pr.deposit_pence",
      "pr.valid_until",
      "pr.terms",
      "pr.terms_file_id",
      "pr.accepted_at",
      "pr.accepted_name",
      "pr.project_id",
      "p.site_address_line1",
      "p.site_town",
      "p.site_postcode",
      "c.name as contact_name",
      "co.name as company_name",
      "co.mcs_number",
      "co.brand_primary_colour",
      "co.document_prefix",
      "co.phone as company_phone",
      "co.email as company_email",
      "co.website as company_website",
      "co.bank_account_name",
      "co.bank_sort_code",
      "co.bank_account_number",
      "co.payment_terms",
    ])
    .where("pr.id", "=", proposalId);
  if (companyId) pq = pq.where("pr.company_id", "=", companyId);
  const proposal = await pq.executeTakeFirst();
  if (!proposal) return null;
  let lq = tx.selectFrom("proposal_lines").selectAll().where("proposal_id", "=", proposalId).orderBy("position");
  if (companyId) lq = lq.where("company_id", "=", companyId);
  const lines = await lq.execute();
  return { proposal, lines };
}

export type ProposalContent = NonNullable<Awaited<ReturnType<typeof proposalContent>>>;

/** Content in the shape ProposalDocument renders. */
export function proposalView(c: ProposalContent): ProposalView {
  const p = c.proposal;
  return {
    companyName: p.company_name,
    mcsNumber: p.mcs_number,
    documentPrefix: p.document_prefix,
    number: p.number,
    version: p.version,
    validUntil: p.valid_until,
    title: p.title,
    intro: p.intro,
    contactName: p.contact_name,
    depositPct: Number(p.deposit_pct),
    summary: (p.summary ?? {}) as unknown as ProposalView["summary"],
    lines: c.lines.map((l) => ({ id: l.id, section: l.section, description: l.description, quantity: Number(l.quantity), unitPricePence: Number(l.unit_price_pence), vatRate: Number(l.vat_rate) })),
    terms: p.terms,
  };
}

/** Customer opened the link: count it and move Sent → Viewed (service role only). */
/** Record a customer view; true for the first one (the team is told once). */
export async function recordProposalView(tx: Tx, p: PublicProposal, userAgent: string | null): Promise<boolean> {
  await tx.insertInto("proposal_views").values({ company_id: p.companyId, proposal_id: p.id, user_agent: userAgent?.slice(0, 300) ?? null }).execute();
  await tx
    .updateTable("proposals")
    .set((eb) => ({
      view_count: eb("view_count", "+", 1),
      first_viewed_at: sql<Date>`coalesce(first_viewed_at, now())`,
      last_viewed_at: sql<Date>`now()`,
      ...(p.status === "sent" ? { status: "viewed" as const } : {}),
    }))
    .where("id", "=", p.id)
    .where("company_id", "=", p.companyId)
    .execute();
  if (p.status === "sent") {
    await tx.insertInto("activity_log").values({ company_id: p.companyId, project_id: p.projectId, contact_id: p.contactId, actor_id: null, event: "proposal_viewed", payload: {} }).execute();
  }
  return p.status === "sent";
}

/** Work out the proposal's finance for its total price and store it in the summary (drafts only). */
export async function refreshProposalFinance(tx: Tx, proposalId: string) {
  const p = await tx.selectFrom("proposals").select(["summary", "total_pence", "status"]).where("id", "=", proposalId).executeTakeFirstOrThrow();
  if (p.status !== "draft") return;
  const summary = (p.summary ?? {}) as unknown as ProposalSummary;
  const { finance } = financeForSummary(summary, Number(p.total_pence));
  await tx.updateTable("proposals").set({ summary: JSON.stringify({ ...summary, finance }) }).where("id", "=", proposalId).execute();
}

/** The proposal view with short-lived URLs for its saved layout image and terms PDF. */
export async function proposalViewWithLayout(c: ProposalContent): Promise<ProposalView> {
  const view = proposalView(c);
  const path = view.summary.layout?.path;
  const termsPath = c.proposal.terms_file_path;
  const urls = await signedUrls([path, termsPath].filter((x): x is string => Boolean(x)), 3600);
  if (path) view.layoutUrl = urls.get(path) ?? null;
  if (termsPath) {
    const url = urls.get(termsPath);
    if (url) view.termsFile = { url, name: c.proposal.terms_file_name ?? "Terms and conditions.pdf" };
  }
  return view;
}
