import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { buildLinesFromDesigns, type CatalogueItem, type ProductCategory, type VatRates } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";
import { env } from "./env";

/** Secret for proposal links. A dedicated one if set; else the service key (server-only either way). */
function linkSecret() {
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
      .select(["id", "name", "vat_rates", "shared_visit_discount_pence", "default_deposit_pct", "proposal_valid_days", "terms_and_conditions", "document_prefix", "design_settings"])
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
  const settings = (company.design_settings ?? {}) as { importPencePerKwh?: number; exportPencePerKwh?: number };
  const summary = {
    kWp: solar ? Number(solar.kwp) : null,
    panelCount: solar?.panel_count ?? null,
    annualKwh: solar?.annual_kwh_mcs ?? null,
    selfUse: solar?.self_consumption_with_battery ?? solar?.self_consumption ?? null,
    yearlySavingPence:
      solar?.annual_kwh_mcs && (solar.self_consumption_with_battery ?? solar.self_consumption) !== null && settings.importPencePerKwh != null && settings.exportPencePerKwh != null
        ? Math.round(solar.annual_kwh_mcs * (Number(solar.self_consumption_with_battery ?? solar.self_consumption) * settings.importPencePerKwh + (1 - Number(solar.self_consumption_with_battery ?? solar.self_consumption)) * settings.exportPencePerKwh))
        : null,
    evRouteM: ev?.route_length_m === null || ev?.route_length_m === undefined ? null : Number(ev.route_length_m),
    segments: solar ? (solar.segments as unknown[]) : [],
  };
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
    .select([
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
