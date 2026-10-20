/**
 * Proposal rules: lines generated from the designs at catalogue sell prices,
 * VAT per line at the company's configured rates (nothing assumed), totals
 * and deposit. Money is integer pence.
 */
import type { ProductCategory } from "./catalogue";

export type ProposalSection = "solar" | "battery" | "ev" | "installation";

export const SECTION_LABELS: Record<ProposalSection, string> = {
  solar: "Solar PV",
  battery: "Battery",
  ev: "EV charging",
  installation: "Installation",
};

export interface DraftLine {
  section: ProposalSection;
  productId: string | null;
  description: string;
  quantity: number;
  unitPricePence: number;
  vatRate: number;
  origin: "design" | "custom" | "discount";
}

/** VAT rate per product category (and "labour" for discounts and custom labour lines). */
export type VatRates = Partial<Record<ProductCategory | "discount", number>>;

export interface CatalogueItem {
  id: string;
  name: string;
  category: ProductCategory;
  sellPence: number | null;
}

export function sectionFor(category: ProductCategory): ProposalSection {
  if (category === "panel" || category === "inverter" || category === "mounting") return "solar";
  if (category === "battery") return "battery";
  if (category === "ev_charger") return "ev";
  return "installation";
}

export interface BuildInput {
  solar: { panel: CatalogueItem | null; panelCount: number; kWp: number; inverter: CatalogueItem | null; battery: CatalogueItem | null; batteryCount: number } | null;
  ev: { charger: CatalogueItem | null; routeLengthM: number | null } | null;
  vatRates: VatRates;
  /** Shared-visit discount (positive pence) when solar and EV are installed together. */
  sharedVisitDiscountPence: number | null;
}

/**
 * Lines from the active designs. Each missing price or VAT rate is reported
 * so staff can fix the catalogue or settings rather than send a wrong total.
 */
export function buildLinesFromDesigns(input: BuildInput): { lines: DraftLine[]; notes: string[] } {
  const lines: DraftLine[] = [];
  const notes: string[] = [];
  const add = (item: CatalogueItem | null, quantity: number, description: string) => {
    if (!item || quantity <= 0) return;
    const rate = input.vatRates[item.category];
    if (item.sellPence === null) notes.push(`${item.name} has no sell price in the catalogue.`);
    if (rate === undefined) notes.push(`Set the VAT rate for ${item.category.replace("_", " ")} products in Settings › Invoices & quotes.`);
    lines.push({ section: sectionFor(item.category), productId: item.id, description, quantity, unitPricePence: item.sellPence ?? 0, vatRate: rate ?? 0, origin: "design" });
  };
  const s = input.solar;
  if (s) {
    add(s.panel, s.panelCount, s.panel ? `${s.panel.name} (${s.kWp.toFixed(2)} kWp)` : "");
    add(s.inverter, 1, s.inverter?.name ?? "");
    add(s.battery, s.batteryCount, s.battery?.name ?? "");
  }
  const e = input.ev;
  if (e) add(e.charger, 1, e.charger ? `${e.charger.name}${e.routeLengthM ? `, ${e.routeLengthM} m cable run` : ""}` : "");
  if (s?.panelCount && e?.charger && input.sharedVisitDiscountPence) {
    const rate = input.vatRates.discount ?? input.vatRates.labour;
    if (rate === undefined) notes.push("Set the VAT rate for labour (used for discounts) in Settings › Invoices & quotes.");
    lines.push({ section: "installation", productId: null, description: "Single visit for solar and EV", quantity: 1, unitPricePence: -input.sharedVisitDiscountPence, vatRate: rate ?? 0, origin: "discount" });
  }
  return { lines, notes: [...new Set(notes)] };
}

export function lineTotal(l: Pick<DraftLine, "quantity" | "unitPricePence">): number {
  return Math.round(l.quantity * l.unitPricePence);
}

export interface ProposalTotals {
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
  depositPence: number;
  balancePence: number;
  /** VAT broken down by rate, for the summary. */
  vatByRate: { rate: number; netPence: number; vatPence: number }[];
}

/** Totals with VAT worked out per rate band (sum of net per rate × rate), then the deposit. */
export function proposalTotals(lines: readonly Pick<DraftLine, "quantity" | "unitPricePence" | "vatRate">[], depositPct: number): ProposalTotals {
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + lineTotal(l));
  const vatByRate = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, netPence]) => ({ rate, netPence, vatPence: Math.round((netPence * rate) / 100) }));
  const subtotalPence = vatByRate.reduce((n, r) => n + r.netPence, 0);
  const vatPence = vatByRate.reduce((n, r) => n + r.vatPence, 0);
  const totalPence = subtotalPence + vatPence;
  const depositPence = Math.round((totalPence * depositPct) / 100);
  return { subtotalPence, vatPence, totalPence, depositPence, balancePence: totalPence - depositPence, vatByRate };
}

/** Q-0142 style reference from the company prefix and number. */
export function proposalReference(prefix: string | null, number: number, version?: number) {
  const ref = `${(prefix || "Q").replace(/-$/, "")}-${String(number).padStart(4, "0")}`;
  return version ? `${ref} · v${version}` : ref;
}

/** Simple payback in years from cost and yearly saving (shown, not promised). */
export function paybackYears(totalPence: number, yearlySavingPence: number | null): number | null {
  return yearlySavingPence && yearlySavingPence > 0 ? Math.round((totalPence / yearlySavingPence) * 10) / 10 : null;
}
