import "server-only";
import { jobProfit, type JobProfit } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";

/**
 * Profit on a proposal (staff only, RLS): its lines priced at each product's
 * purchase price, or the cheapest supplier offer when no purchase price is set.
 */
export async function proposalProfit(tx: Tx, proposalId: string): Promise<JobProfit> {
  const lines = await tx.selectFrom("proposal_lines").select(["product_id", "description", "quantity", "unit_price_pence"]).where("proposal_id", "=", proposalId).orderBy("position").execute();
  const ids = [...new Set(lines.flatMap((l) => (l.product_id ? [l.product_id] : [])))];
  const costs = new Map<string, number>();
  if (ids.length) {
    const rows = await tx
      .selectFrom("products as p")
      .select(["p.id", "p.cost_price_pence", sql<string | null>`(select min(sp.cost_pence) from supplier_products sp where sp.product_id = p.id and sp.company_id = p.company_id and sp.cost_pence is not null)`.as("best")])
      .where("p.id", "in", ids)
      .execute();
    for (const r of rows) {
      const c = r.cost_price_pence ?? r.best;
      if (c !== null && c !== undefined) costs.set(r.id, Number(c));
    }
  }
  return jobProfit(
    lines.map((l) => ({ productId: l.product_id, description: l.description, quantity: Number(l.quantity), unitPricePence: Number(l.unit_price_pence) })),
    costs,
  );
}

/** The project's profit from its accepted quote, else its latest proposal. */
export async function projectProfit(tx: Tx, projectId: string): Promise<{ profit: JobProfit; accepted: boolean } | null> {
  const p = await tx
    .selectFrom("proposals")
    .select(["id", "status"])
    .where("project_id", "=", projectId)
    .orderBy(sql`status = 'accepted'`, "desc")
    .orderBy("number", "desc")
    .orderBy("version", "desc")
    .executeTakeFirst();
  if (!p) return null;
  return { profit: await proposalProfit(tx, p.id), accepted: p.status === "accepted" };
}
