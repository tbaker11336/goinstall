import "server-only";
import { chosenOffer, kitFromProposal, type KitLine } from "@goinstall/core";
import type { Tx } from "@goinstall/db";
import { listCatalogue, type CatalogueOffer } from "./catalogue";

/** The accepted proposal for a project (the kit and the margin come from it). */
export async function acceptedProposal(tx: Tx, projectId: string) {
  return tx.selectFrom("proposals").select(["id", "number", "version"]).where("project_id", "=", projectId).where("status", "=", "accepted").orderBy("accepted_at", "desc").executeTakeFirst();
}

/** Create the kit list from the accepted proposal the first time the tab is opened. */
export async function ensureKit(tx: Tx, projectId: string): Promise<boolean> {
  const existing = await tx.selectFrom("kit_items").select("id").where("project_id", "=", projectId).limit(1).executeTakeFirst();
  if (existing) return true;
  const proposal = await acceptedProposal(tx, projectId);
  if (!proposal) return false;
  const lines = await tx.selectFrom("proposal_lines").select(["product_id", "description", "quantity", "line_total_pence"]).where("proposal_id", "=", proposal.id).orderBy("position").execute();
  const kit = kitFromProposal(lines.map((l) => ({ productId: l.product_id, description: l.description, quantity: Number(l.quantity), lineTotalPence: Number(l.line_total_pence) })));
  if (!kit.length) return false;
  await tx
    .insertInto("kit_items")
    .values(kit.map((k, i) => ({ project_id: projectId, product_id: k.productId, description: k.description, quantity: k.quantity, position: i })))
    .onConflict((oc) => oc.doNothing())
    .execute();
  return true;
}

export interface KitRow extends KitLine<CatalogueOffer> {
  productId: string;
  description: string;
  unit: string;
  overrideSupplierId: string | null;
  offers: CatalogueOffer[];
  issue: string | null;
  issueNote: string | null;
}

export async function loadKit(tx: Tx, projectId: string) {
  const proposal = await acceptedProposal(tx, projectId);
  const [items, catalogue, sells] = await Promise.all([
    tx.selectFrom("kit_items").selectAll().where("project_id", "=", projectId).orderBy("position").execute(),
    listCatalogue(tx, { includeArchived: true }),
    proposal
      ? tx.selectFrom("proposal_lines").select(["product_id", "line_total_pence"]).where("proposal_id", "=", proposal.id).where("product_id", "is not", null).execute()
      : Promise.resolve([]),
  ]);
  const rows: KitRow[] = items.map((it) => {
    const product = catalogue.find((p) => p.id === it.product_id);
    const offers = product?.offers ?? [];
    const qty = Number(it.quantity);
    const sell = sells.filter((s) => s.product_id === it.product_id).reduce((n, s) => n + Number(s.line_total_pence), 0);
    return {
      id: it.id,
      productId: it.product_id,
      description: it.description,
      unit: product?.unit ?? "each",
      quantity: qty,
      sellPence: sell,
      overrideSupplierId: it.supplier_id,
      offers,
      offer: chosenOffer(offers, qty, it.supplier_id),
      issue: it.issue,
      issueNote: it.issue_note,
    };
  });
  const suppliers = [...new Map(rows.flatMap((r) => r.offers).map((o) => [o.supplierId, o.supplierName])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  return { proposal, rows, suppliers };
}
