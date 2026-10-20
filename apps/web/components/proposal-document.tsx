import { formatPence, paybackYears, proposalReference, proposalTotals, SECTION_LABELS, type ProposalSection } from "@goinstall/core";
import { formatDate } from "@/lib/utils";

export interface ProposalView {
  companyName: string;
  mcsNumber: string | null;
  documentPrefix: string | null;
  number: number;
  version: number;
  validUntil: Date | string | null;
  title: string;
  intro: string | null;
  contactName: string;
  depositPct: number;
  summary: { kWp?: number | null; panelCount?: number | null; annualKwh?: number | null; yearlySavingPence?: number | null };
  lines: { id: string; section: string; description: string; quantity: number; unitPricePence: number; vatRate: number }[];
  terms: string | null;
}

const SECTIONS: ProposalSection[] = ["solar", "battery", "ev", "installation"];

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter((w) => /^[A-Za-z0-9]/.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "·"
  );
}

/** Rough roof sketch with the panel count; the real layout is on the Design tab. */
function RoofSketch({ panels }: { panels: number }) {
  const n = Math.min(panels, 24);
  const perRow = Math.min(Math.max(Math.ceil(n / 2), 1), 12);
  const rows = Math.ceil(n / perRow);
  const w = 26;
  const h = 30;
  const gap = 3;
  const startX = 165 - (perRow * (w + gap) - gap) / 2;
  const startY = 150 - rows * (h + gap);
  return (
    <svg viewBox="0 0 330 190" role="img" aria-label={`Roof sketch with ${panels} panels`} className="h-full w-full">
      <rect width="330" height="190" fill="var(--accent-tint)" />
      <path d="M40 20 H290 V170 H40 Z" fill="#b9a898" />
      <path d="M40 20 L100 110 H230 L290 20 Z M40 170 L100 110 H230 L290 170 Z" fill="#c8b8a8" />
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={startX + (i % perRow) * (w + gap)} y={startY + Math.floor(i / perRow) * (h + gap)} width={w} height={h} rx="1.5" fill="#1e2a3e" />
      ))}
    </svg>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[10px] bg-surface-subtle p-4">
      <span className="text-[13px] text-ink-3">{label}</span>
      <span className="text-xl font-bold tracking-[-0.01em]">{value}</span>
    </div>
  );
}

/** The proposal as the customer sees it (console preview and public page). */
export function ProposalDocument({ p }: { p: ProposalView }) {
  const totals = proposalTotals(p.lines, p.depositPct);
  const payback = paybackYears(totals.totalPence, p.summary.yearlySavingPence ?? null);
  const tiles = [
    p.summary.annualKwh ? { label: "Generation", value: `${Math.round(p.summary.annualKwh).toLocaleString("en-GB")} kWh` } : null,
    p.summary.yearlySavingPence ? { label: "Yearly saving", value: formatPence(Math.round(p.summary.yearlySavingPence / 100) * 100) } : null,
    payback ? { label: "Payback", value: `${payback} yrs` } : null,
    p.summary.kWp ? { label: "System size", value: `${Number(p.summary.kWp).toFixed(2)} kWp` } : null,
  ].filter((t): t is { label: string; value: string } => Boolean(t));

  return (
    <article className="flex flex-col gap-6 rounded-[14px] border bg-card p-8 max-md:p-5" aria-label="Proposal">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid size-11 place-items-center rounded-[10px] bg-foreground text-sm font-bold text-white">
            {initials(p.companyName)}
          </span>
          <div>
            <p className="font-bold">{p.companyName}</p>
            <p className="text-[13px] text-ink-3">{p.mcsNumber ? `MCS certified installer · ${p.mcsNumber}` : "Installer"}</p>
          </div>
        </div>
        <div className="text-right text-[13px] text-ink-3">
          <p>Proposal {proposalReference(p.documentPrefix, p.number, p.version)}</p>
          {p.validUntil && <p>Valid until {formatDate(p.validUntil, { day: "numeric", month: "long", year: "numeric" })}</p>}
        </div>
      </header>

      <div>
        <h2 className="text-[22px] font-bold tracking-[-0.02em]">{p.title}</h2>
        <p className="text-ink-3">Prepared for {p.contactName}</p>
        {p.intro && <p className="mt-3 whitespace-pre-line text-sm text-ink-2">{p.intro}</p>}
      </div>

      {(p.summary.panelCount || tiles.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-[1.7fr_1fr_1fr]">
          {p.summary.panelCount ? (
            <div className="overflow-hidden rounded-[10px] sm:row-span-2">
              <RoofSketch panels={p.summary.panelCount} />
            </div>
          ) : null}
          {tiles.map((t) => (
            <Tile key={t.label} {...t} />
          ))}
        </div>
      )}

      {SECTIONS.map((s) => {
        const lines = p.lines.filter((l) => l.section === s);
        if (!lines.length) return null;
        return (
          <section key={s} aria-labelledby={`sec-${s}`}>
            <h3 id={`sec-${s}`} className="mb-1 text-xs font-bold tracking-[0.06em] text-ink-3 uppercase">
              {SECTION_LABELS[s]}
            </h3>
            <ul>
              {lines.map((l) => {
                const total = Math.round(l.quantity * l.unitPricePence);
                return (
                  <li key={l.id} className="flex justify-between gap-4 border-b py-3 text-[15px]">
                    <span>
                      {l.quantity !== 1 && !l.description.match(/^\d+\s*×/) ? `${l.quantity} × ` : ""}
                      {l.description}
                    </span>
                    <span className={total < 0 ? "font-medium text-primary" : "font-medium"}>{total < 0 ? `−${formatPence(-total)}` : formatPence(total)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <dl className="ml-auto grid w-full max-w-[440px] grid-cols-[1fr_auto] gap-x-8 gap-y-1.5 text-right">
        <dt className="text-ink-3">Subtotal</dt>
        <dd>{formatPence(totals.subtotalPence)}</dd>
        {totals.vatByRate.length > 1 ? (
          totals.vatByRate.map((r) => (
            <div key={r.rate} className="contents">
              <dt className="text-ink-3">VAT at {r.rate}%</dt>
              <dd>{formatPence(r.vatPence)}</dd>
            </div>
          ))
        ) : (
          <>
            <dt className="text-ink-3">VAT{totals.vatByRate[0] ? ` at ${totals.vatByRate[0].rate}%` : ""}</dt>
            <dd>{formatPence(totals.vatPence)}</dd>
          </>
        )}
        <dt className="text-2xl font-bold">Total</dt>
        <dd className="text-2xl font-bold" data-testid="proposal-total">
          {formatPence(totals.totalPence)}
        </dd>
        {totals.depositPence > 0 && (
          <div className="col-span-2 mt-2 flex justify-between rounded-[10px] bg-accent-tint px-4 py-2.5 font-semibold text-accent-strong">
            <span>Deposit to confirm ({p.depositPct}%)</span>
            <span>{formatPence(totals.depositPence)}</span>
          </div>
        )}
      </dl>

      {p.terms && (
        <details className="border-t pt-4 text-sm">
          <summary className="cursor-pointer font-semibold">Terms and conditions</summary>
          <p className="mt-2 whitespace-pre-line text-ink-3">{p.terms}</p>
        </details>
      )}
    </article>
  );
}
