import { formatPence, inStock, kitTotals, splitOrders } from "@goinstall/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { placeOrdersAction } from "@/lib/actions/kit";
import { asUser } from "@/lib/auth";
import { signedUrls } from "@/lib/files";
import { ensureKit, loadKit } from "@/lib/kit";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { PoStatusButtons, SupplierCell } from "./kit-client";

export const metadata = { title: "Kit & suppliers" };

const PO_BADGE: Record<string, "default" | "success" | "warning"> = { draft: "warning", sent: "default", confirmed: "default", delivered: "success", cancelled: "default" };
const PO_LABEL: Record<string, string> = { draft: "Draft", sent: "Sent", confirmed: "Confirmed", delivered: "Delivered", cancelled: "Cancelled" };
const CONNECTION: Record<string, string> = { api: "API", price_file: "Price file", email: "Email only" };

function stockText(o: { stockQty: number | null; leadTimeDays: number | null }, qty: number) {
  if (inStock({ supplierId: "", costPence: 0, ...o }, qty)) return "In stock";
  if (o.leadTimeDays) return `${o.leadTimeDays} day${o.leadTimeDays === 1 ? "" : "s"}`;
  return o.stockQty !== null ? `${o.stockQty} in stock` : "Ask supplier";
}

function Initial({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-[9px] bg-info-tint text-sm font-bold text-info-text", className)}>
      {name.replace(/^supplier\s+/i, "").charAt(0).toUpperCase()}
    </span>
  );
}

export default async function KitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await asUser(async (tx) => {
    const project = await tx.selectFrom("projects").select(["id"]).where("id", "=", id).executeTakeFirst();
    if (!project) return null;
    const hasKit = await ensureKit(tx, id);
    const [kit, orders, suppliers, company] = await Promise.all([
      loadKit(tx, id),
      tx
        .selectFrom("purchase_orders as po")
        .innerJoin("suppliers as s", "s.id", "po.supplier_id")
        .leftJoin("files as f", "f.id", "po.file_id")
        .select(["po.id", "po.number", "po.status", "po.total_pence", "po.deliver_to", "po.expected_date", "po.sent_at", "s.name as supplier_name", "s.connection", "f.path as file_path"])
        .where("po.project_id", "=", id)
        .orderBy("po.created_at")
        .execute(),
      tx.selectFrom("suppliers").select(["id", "name", "connection", "last_sync_at", "order_email"]).where("archived_at", "is", null).orderBy("name").execute(),
      tx.selectFrom("companies").select(["depot_address"]).executeTakeFirstOrThrow(),
    ]);
    const lineItems = await tx
      .selectFrom("purchase_order_lines as l")
      .innerJoin("purchase_orders as po", "po.id", "l.purchase_order_id")
      .select(["po.id as po_id", "l.description", "l.product_id"])
      .where("po.project_id", "=", id)
      .execute();
    return { hasKit, kit, orders, suppliers, company, lineItems };
  });
  if (!data) notFound();
  const { hasKit, kit, orders, suppliers, company, lineItems } = data;

  if (!hasKit) {
    return (
      <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">
        The kit list is made from the accepted proposal. Once the customer accepts, it appears here.{" "}
        <Link href={`/projects/${id}/proposal`} className="font-semibold text-primary">
          Go to the proposal
        </Link>
      </p>
    );
  }

  const totals = kitTotals(kit.rows);
  const live = new Set(lineItems.filter((l) => orders.find((o) => o.id === l.po_id && o.status !== "cancelled")).map((l) => l.product_id));
  const toOrder = splitOrders(kit.rows.filter((r) => !live.has(r.productId)));
  const pdfUrls = await signedUrls(orders.flatMap((o) => (o.file_path ? [o.file_path] : [])));
  const columns = kit.suppliers;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader className="flex-wrap items-start">
            <div>
              <CardTitle>Kit list</CardTitle>
              <p className="text-sm text-ink-3">From the accepted proposal · cheapest in-stock option picked for each line. Choose a price to buy from another supplier.</p>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            <table className="w-full min-w-[720px] text-[15px]">
              <caption className="sr-only">Kit list with a price per supplier</caption>
              <thead>
                <tr className="border-y bg-surface-subtle text-left text-[13px] text-ink-3">
                  <th className="px-5 py-3 font-semibold">Item</th>
                  <th className="px-2 py-3 font-semibold">Qty</th>
                  {columns.map((s) => (
                    <th key={s.id} className="px-2 py-3 font-semibold">
                      {s.name}
                    </th>
                  ))}
                  <th className="px-5 py-3 text-right font-semibold">Line cost</th>
                </tr>
              </thead>
              <tbody>
                {kit.rows.map((r) => (
                  <tr key={r.id} className="border-b" data-testid="kit-line">
                    <th scope="row" className="px-5 py-3 text-left font-semibold">
                      {r.description}
                      {live.has(r.productId) && <span className="block text-xs font-normal text-success-text">On an order</span>}
                      {r.issue && (
                        <span className="block text-xs font-normal text-warning-text">
                          Reported {r.issue} by installer{r.issueNote ? `: ${r.issueNote}` : ""}
                        </span>
                      )}
                    </th>
                    <td className="px-2 py-3">
                      {r.quantity}
                      {r.unit === "kit" ? " kit" : ""}
                    </td>
                    {columns.map((s) => {
                      const o = r.offers.find((x) => x.supplierId === s.id);
                      if (!o || o.costPence === null) {
                        return (
                          <td key={s.id} className="px-2 py-3 pl-5.5 text-muted-foreground">
                            Not stocked
                          </td>
                        );
                      }
                      return (
                        <td key={s.id} className="px-2 py-2">
                          <SupplierCell
                            itemId={r.id}
                            supplierId={s.id}
                            chosen={r.offer?.supplierId === s.id}
                            isOverride={r.overrideSupplierId === s.id}
                            price={formatPence(o.costPence)}
                            stock={stockText(o, r.quantity)}
                            inStock={inStock(o, r.quantity)}
                            label={`${r.description} from ${s.name}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-5 py-3 text-right font-semibold">{r.offer?.costPence != null ? formatPence(Math.round(r.offer.costPence * r.quantity)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap justify-end gap-10 bg-surface-subtle px-5 py-4">
              <div className="text-right">
                <p className="text-[13px] text-ink-3">Kit cost</p>
                <p className="text-2xl font-bold" data-testid="kit-cost">
                  {formatPence(totals.costPence)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[13px] text-ink-3">Margin on kit</p>
                <p className="text-2xl font-bold text-primary">{totals.marginPct === null ? "—" : `${totals.marginPct}% · ${formatPence(totals.marginPence)}`}</p>
              </div>
            </div>
            {totals.unpriced > 0 && <p className="px-5 pt-3 text-sm text-warning-text">{totals.unpriced} line(s) have no supplier price, so they aren&apos;t counted or ordered.</p>}
          </CardContent>
        </Card>

        {toOrder.orders.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                Place {toOrder.orders.length} order{toOrder.orders.length === 1 ? "" : "s"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={placeOrdersAction.bind(null, id)} className="grid gap-4 sm:grid-cols-2">
                <fieldset className="grid gap-1.5">
                  <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">Deliver to</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="deliver_to" value="site" defaultChecked className="accent-[var(--primary)]" /> Site
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="deliver_to" value="depot" disabled={!company.depot_address} className="accent-[var(--primary)]" /> Depot
                    {!company.depot_address && <span className="text-xs text-muted-foreground">(add the address in Company details)</span>}
                  </label>
                </fieldset>
                <Field label="Needed by" htmlFor="expected_date">
                  <Input id="expected_date" name="expected_date" type="date" />
                </Field>
                <Field label="Note to suppliers (optional)" htmlFor="po-notes" className="sm:col-span-2">
                  <Textarea id="po-notes" name="notes" rows={2} />
                </Field>
                <p className="text-sm text-ink-3 sm:col-span-2">
                  {toOrder.orders.map((o) => `${columns.find((c) => c.id === o.supplierId)?.name}: ${formatPence(o.totalPence)}`).join(" · ")}. Each order is emailed to the supplier as a PDF.
                </p>
                <div className="sm:col-span-2">
                  <SubmitButton pendingText="Placing orders…">
                    Place {toOrder.orders.length} order{toOrder.orders.length === 1 ? "" : "s"} →
                  </SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <ul className="divide-y">
                {orders.map((o) => {
                  const items = lineItems.filter((l) => l.po_id === o.id).map((l) => l.description);
                  const url = o.file_path ? pdfUrls.get(o.file_path) : null;
                  return (
                    <li key={o.id} className="flex flex-wrap items-center gap-3.5 py-3.5" data-testid="purchase-order">
                      <Initial name={o.supplier_name} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {o.supplier_name} · {o.number} · {formatPence(Number(o.total_pence))}
                        </p>
                        <p className="text-[13px] text-ink-3">
                          {items.join(", ")} · deliver to {o.deliver_to}
                          {o.expected_date ? ` ${formatDate(o.expected_date, { weekday: "short", day: "numeric", month: "short" })}` : ""}
                          {o.sent_at ? " · PO emailed as PDF" : ""}
                          {url && (
                            <>
                              {" · "}
                              <a href={url} download={`${o.number}.pdf`} className="font-semibold text-primary">
                                PDF
                              </a>
                            </>
                          )}
                        </p>
                      </div>
                      <Badge variant={PO_BADGE[o.status]}>{PO_LABEL[o.status]}</Badge>
                      <PoStatusButtons poId={o.id} status={o.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Supplier connections</CardTitle>
          <p className="text-sm text-ink-3">Connected suppliers share live prices, stock and order tracking. Price-file suppliers are updated when you upload a file.</p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {suppliers.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <Initial name={s.name} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-[13px] text-ink-3">
                    {CONNECTION[s.connection]}
                    {s.last_sync_at ? ` · prices updated ${timeAgo(s.last_sync_at)}` : ""}
                    {!s.order_email && s.connection !== "api" ? " · no order email" : ""}
                  </p>
                </div>
                <Badge variant={s.connection === "api" ? "success" : "default"}>{s.connection === "api" ? "Live" : "Manual"}</Badge>
              </li>
            ))}
          </ul>
          <Link href="/settings/products" className={cn(buttonVariants({ variant: "outline" }), "mt-3 w-full")}>
            Connect a supplier
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
