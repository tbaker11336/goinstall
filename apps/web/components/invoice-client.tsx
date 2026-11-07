"use client";

import { formatPence, INVOICE_KIND_LABELS, planInvoice, parsePence, type InvoiceKind, type InvoiceLike, type QuoteTotals } from "@goinstall/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionForm, FormMessage, SubmitButton, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { createInvoiceAction, emailInvoiceAction, recordPaymentAction, voidInvoiceAction } from "@/lib/actions/invoices";
import { cn } from "@/lib/utils";

const money = (v: string) => {
  const p = parsePence(v.replace(/[£,\s]/g, ""));
  return p === null || Number.isNaN(p) ? null : p;
};

/** Raise an invoice on the accepted quote, with the amount worked out as you type. */
export function NewInvoiceForm({ projectId, quote, invoices, canEmail }: { projectId: string; quote: QuoteTotals; invoices: InvoiceLike[]; canEmail: boolean }) {
  const live = invoices.filter((i) => i.status !== "void");
  const kinds: InvoiceKind[] = [...(live.some((i) => i.kind === "deposit") || quote.depositPence <= 0 ? [] : (["deposit"] as const)), "stage", ...(live.some((i) => i.kind === "balance") ? [] : (["balance"] as const)), "extra"];
  const [kind, setKind] = useState<InvoiceKind>(kinds[0]!);
  const [by, setBy] = useState<"percent" | "amount">("percent");
  const [percent, setPercent] = useState("");
  const [amount, setAmount] = useState("");
  const [net, setNet] = useState("");
  const [rate, setRate] = useState("");
  const plan =
    kind === "stage"
      ? by === "percent"
        ? percent && Number.isFinite(Number(percent))
          ? planInvoice(quote, invoices, { kind, percent: Number(percent) })
          : null
        : money(amount) !== null
          ? planInvoice(quote, invoices, { kind, amountPence: money(amount)! })
          : null
      : kind === "extra"
        ? money(net) !== null && rate.trim() !== "" && Number.isFinite(Number(rate))
          ? planInvoice(quote, invoices, { kind, netPence: money(net)!, vatRate: Number(rate) })
          : null
        : planInvoice(quote, invoices, { kind });

  return (
    <ActionForm action={createInvoiceAction.bind(null, projectId)} className="flex flex-col gap-4" resetOnSuccess>
      <input type="hidden" name="kind" value={kind} />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">What for</legend>
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <label key={k} className={cn("cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold has-focus-visible:ring-2 has-focus-visible:ring-ring", kind === k ? "border-primary bg-accent-tint text-accent-strong" : "text-ink-2 hover:bg-muted")}>
              <input type="radio" name="kind-choice" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              {INVOICE_KIND_LABELS[k]}
            </label>
          ))}
        </div>
      </fieldset>

      {kind === "stage" && (
        <div className="flex flex-wrap items-end gap-3">
          <fieldset>
            <legend className="sr-only">Stage payment by</legend>
            <div className="flex overflow-hidden rounded-md border">
              {(["percent", "amount"] as const).map((b) => (
                <label key={b} className={cn("cursor-pointer px-3 py-2 text-sm", by === b ? "bg-accent-tint font-semibold text-accent-strong" : "text-ink-2")}>
                  <input type="radio" name="stage_by" value={b} checked={by === b} onChange={() => setBy(b)} className="sr-only" />
                  {b === "percent" ? "% of the quote" : "Amount"}
                </label>
              ))}
            </div>
          </fieldset>
          {by === "percent" ? (
            <Field label="Percentage of the quote" htmlFor="inv-percent">
              <Input id="inv-percent" name="percent" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} className="w-32" />
            </Field>
          ) : (
            <Field label="Amount including VAT (£)" htmlFor="inv-amount">
              <Input id="inv-amount" name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-40" />
            </Field>
          )}
        </div>
      )}
      {kind === "extra" && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Amount before VAT (£)" htmlFor="inv-net">
            <Input id="inv-net" name="net" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} className="w-40" />
          </Field>
          <Field label="VAT rate (%)" htmlFor="inv-rate">
            <Input id="inv-rate" name="vat_rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="w-28" />
          </Field>
        </div>
      )}

      <Field label={kind === "extra" ? "Description" : "Description (optional)"} htmlFor="inv-desc" hint="Shown on the invoice, e.g. “Stage 2: panels fitted and scaffold down”.">
        <Textarea id="inv-desc" name="description" rows={2} maxLength={500} required={kind === "extra"} aria-describedby="inv-desc-hint" />
      </Field>
      <div className="flex flex-wrap items-end gap-6">
        <Field label="Due date (optional)" htmlFor="inv-due">
          <Input id="inv-due" name="due_date" type="date" />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="send" value="1" defaultChecked={canEmail} disabled={!canEmail} className="size-4 accent-primary" />
          Email it to the customer now{!canEmail && " (no email address on the contact)"}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-md bg-surface-subtle px-4 py-3" aria-live="polite">
        {plan === null ? (
          <span className="text-sm text-ink-3">Enter the amount to see the invoice total.</span>
        ) : plan.ok ? (
          <span className="text-sm">
            Invoice total <strong className="text-base" data-testid="invoice-preview">{formatPence(plan.amountPence)}</strong> <span className="text-ink-3">(includes VAT {formatPence(plan.vatPence)})</span>
          </span>
        ) : (
          <span role="alert" className="text-sm font-semibold text-red-700">
            {plan.error}
          </span>
        )}
      </div>
      <div>
        <SubmitButton>Raise invoice</SubmitButton>
      </div>
    </ActionForm>
  );
}

function useRun() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  return { pending, state, run: (fn: () => Promise<FormState>) => start(async () => setState(await fn())) };
}

/** Email / record payment / void for one invoice. */
export function InvoiceActions({ invoice }: { invoice: { id: string; number: string; status: string; amountPence: number; sent: boolean } }) {
  const router = useRouter();
  const { pending, state, run } = useRun();
  const [paying, setPaying] = useState(false);
  if (invoice.status !== "open") return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => emailInvoiceAction(invoice.id))} aria-label={`${invoice.sent ? "Email again" : "Email"}: ${invoice.number}`}>
          {invoice.sent ? "Email again" : "Email"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setPaying((v) => !v)} aria-expanded={paying} aria-label={`Record payment: ${invoice.number}`}>
          Record payment
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-label={`Void ${invoice.number}`}
          onClick={() => {
            if (window.confirm(`Void invoice ${invoice.number}? Its pay link stops working.`)) run(async () => {
              const r = await voidInvoiceAction(invoice.id);
              router.refresh();
              return r;
            });
          }}
        >
          Void
        </Button>
      </div>
      {paying && (
        <ActionForm action={recordPaymentAction.bind(null, invoice.id)} className="flex flex-wrap items-end gap-2">
          <Field label="Amount received (£)" htmlFor={`pay-${invoice.id}`}>
            <Input id={`pay-${invoice.id}`} name="amount" inputMode="decimal" defaultValue={(invoice.amountPence / 100).toFixed(2)} className="w-36" />
          </Field>
          <SubmitButton size="sm">Mark paid</SubmitButton>
        </ActionForm>
      )}
      <FormMessage state={state} />
    </div>
  );
}
