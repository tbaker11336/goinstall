import { formatPence, INVOICE_KIND_LABELS, isOverdue, ukDate, type InvoiceKind } from "@goinstall/core";
import Link from "next/link";
import { PageHeader } from "@/components/domain";
import { InvoiceStatus } from "@/components/invoice-status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { asUser } from "@/lib/auth";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Invoices" };

const FILTERS = { unpaid: "Unpaid", overdue: "Overdue", paid: "Paid", all: "All" } as const;
type Filter = keyof typeof FILTERS;

/** Every invoice across projects: what's unpaid, overdue and paid. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const show: Filter = sp.show && sp.show in FILTERS ? (sp.show as Filter) : "unpaid";
  const rows = await asUser(async (tx) => {
    let q = tx
      .selectFrom("invoices as i")
      .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "i.project_id").onRef("p.company_id", "=", "i.company_id"))
      .innerJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
      .select(["i.id", "i.number", "i.kind", "i.status", "i.amount_pence", "i.issued_at", "i.due_date", "i.paid_at", "p.id as project_id", "p.site_address_line1", "p.site_town", "c.name as contact_name"])
      .orderBy("i.issued_at", "desc")
      .limit(500);
    if (show === "unpaid" || show === "overdue") q = q.where("i.status", "=", "open");
    if (show === "paid") q = q.where("i.status", "=", "paid");
    return q.execute();
  });
  const today = ukDate(new Date());
  const list = rows
    .map((r) => ({ ...r, amount: Number(r.amount_pence), overdue: isOverdue({ status: r.status, dueDate: r.due_date ? ukDate(r.due_date) : null }, today) }))
    .filter((r) => show !== "overdue" || r.overdue);
  const unpaid = list.filter((r) => r.status === "open").reduce((n, r) => n + r.amount, 0);

  return (
    <>
      <PageHeader title="Invoices" description={show === "unpaid" || show === "overdue" ? `${list.length} ${FILTERS[show].toLowerCase()} · ${formatPence(unpaid)} to collect` : `${list.length} invoices`} />
      <form action="/invoices" className="mb-4 flex items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Show
          <Select name="show" defaultValue={show} className="w-40">
            {Object.entries(FILTERS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <Card>
        {list.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No {show === "all" ? "" : `${FILTERS[show].toLowerCase()} `}invoices. Raise them from a project&apos;s Invoices tab once its quote is accepted.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Invoices</caption>
              <thead>
                <tr className="border-b text-left text-xs text-ink-3">
                  <th className="px-4 py-3 font-semibold">Invoice</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">For</th>
                  <th className="px-4 py-3 font-semibold">Issued</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0 hover:bg-surface-subtle">
                    <td className="px-4 py-3 font-semibold">
                      <Link href={`/projects/${r.project_id}/invoices`} className="text-primary hover:underline">
                        {r.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {r.contact_name}
                      <span className="block text-xs text-ink-3">{[r.site_address_line1, r.site_town].filter(Boolean).join(", ")}</span>
                    </td>
                    <td className="px-4 py-3">{INVOICE_KIND_LABELS[r.kind as InvoiceKind] ?? "Invoice"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.issued_at, { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{r.due_date ? formatDate(r.due_date, { day: "numeric", month: "short" }) : "—"}</td>
                    <td className="px-4 py-3">
                      <InvoiceStatus status={r.status} overdue={r.overdue} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{formatPence(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
