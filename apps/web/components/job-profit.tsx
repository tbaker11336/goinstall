import { formatPence, type JobProfit } from "@goinstall/core";
import { cn } from "@/lib/utils";

/** Revenue, cost, profit and margin for the office (never shown to customers). */
export function JobProfitSummary({ profit, note }: { profit: JobProfit; note?: string }) {
  const rows: [string, string, string?][] = [
    ["Revenue (ex VAT)", formatPence(profit.revenuePence)],
    ["Purchase costs", formatPence(profit.costPence)],
    ["Profit", formatPence(profit.profitPence), profit.profitPence < 0 ? "text-red-700" : "text-success-text"],
    ["Margin", profit.margin === null ? "—" : `${(profit.margin * 100).toFixed(1)}%`],
  ];
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="job-profit">
      <dl className="divide-y">
        {rows.map(([k, v, tone]) => (
          <div key={k} className="flex justify-between gap-3 py-2">
            <dt className="text-ink-3">{k}</dt>
            <dd className={cn("font-semibold tabular-nums", tone)}>{v}</dd>
          </div>
        ))}
      </dl>
      {profit.uncosted.length > 0 && (
        <p className="text-xs text-ink-3">
          No purchase price for: {profit.uncosted.map((u) => u.description).join(", ")}. These count as profit; add purchase prices in Settings › Products.
        </p>
      )}
      {note && <p className="text-xs text-ink-3">{note}</p>}
    </div>
  );
}
