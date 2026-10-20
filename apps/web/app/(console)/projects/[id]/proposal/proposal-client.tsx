"use client";

import { formatPence, lineTotal, parsePence, proposalTotals, SECTION_LABELS, type ProposalSection } from "@goinstall/core";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { resendBalanceInvoiceAction } from "@/lib/actions/invoices";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  createProposalAction,
  proposalLinkAction,
  saveProposalDraftAction,
  sendProposalAction,
  sendProposalReminderAction,
  type DraftInput,
} from "@/lib/actions/proposals";

export function VersionSelect({ versions, current }: { versions: { id: string; label: string }[]; current: string }) {
  const router = useRouter();
  return (
    <>
      <label htmlFor="proposal-version" className="sr-only">
        Proposal version
      </label>
      <Select id="proposal-version" className="w-auto font-semibold" value={current} onChange={(e) => router.push(`?v=${e.target.value}`)}>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </Select>
    </>
  );
}

/** A button that runs a server action and shows its result. */
function useRun() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  const run = (fn: () => Promise<FormState>) =>
    start(async () => {
      setState({});
      setState(await fn());
    });
  return { pending, state, run, setState };
}

export function SendButton({ proposalId, kind }: { proposalId: string; kind: "send" | "reminder" }) {
  const { pending, state, run } = useRun();
  return (
    <div className="flex flex-col items-end">
      <Button disabled={pending} onClick={() => run(() => (kind === "send" ? sendProposalAction(proposalId) : sendProposalReminderAction(proposalId)))}>
        {pending ? "Sending…" : kind === "send" ? "Send proposal" : "Send reminder"}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}

export function CreateProposalButton({ projectId, label, variant = "default" }: { projectId: string; label: string; variant?: "default" | "outline" }) {
  const router = useRouter();
  const { pending, state, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={variant}
        disabled={pending}
        onClick={() =>
          run(async () => {
            const r = await createProposalAction(projectId);
            if (r.error) return { error: r.error };
            router.push(`/projects/${projectId}/proposal?v=${r.proposalId}`);
            return r.notes?.length ? { error: `Check before sending: ${r.notes.join(" ")}` } : {};
          })
        }
      >
        {pending ? "Building…" : label}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}

export function CopyLinkButton({ proposalId }: { proposalId: string }) {
  const { pending, state, run } = useRun();
  return (
    <div className="flex flex-col">
      <Button
        variant="outline"
        className="w-full"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const r = await proposalLinkAction(proposalId);
            if (!r.url) return { error: r.error };
            try {
              await navigator.clipboard.writeText(r.url);
              return { message: "Link copied." };
            } catch {
              return { message: r.url };
            }
          })
        }
      >
        Copy customer link
      </Button>
      <FormMessage state={state} />
    </div>
  );
}

export interface EditorLine {
  key: string;
  section: ProposalSection;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  origin: "design" | "custom" | "discount";
}

const SECTIONS = Object.keys(SECTION_LABELS) as ProposalSection[];

/** Draft editor: lines (generated and custom), title, intro and deposit, with live totals. */
export function ProposalEditor({
  proposalId,
  initial,
  labourVat,
}: {
  proposalId: string;
  initial: { title: string; intro: string; depositPct: string; lines: EditorLine[] };
  labourVat: number | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [intro, setIntro] = useState(initial.intro);
  const [depositPct, setDepositPct] = useState(initial.depositPct);
  const [lines, setLines] = useState(initial.lines);
  const { pending, state, run } = useRun();

  const parsed = lines.map((l) => ({ quantity: Number(l.quantity) || 0, unitPricePence: parsePence(l.unitPrice.replace(/^−/, "-")) ?? 0, vatRate: Number(l.vatRate) || 0 }));
  const totals = proposalTotals(
    parsed.map((p) => ({ ...p, unitPricePence: Number.isNaN(p.unitPricePence) ? 0 : p.unitPricePence })),
    Number(depositPct) || 0,
  );
  const update = (key: string, patch: Partial<EditorLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) =>
    setLines((ls) => {
      const j = i + d;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const save = () =>
    run(async () => {
      const input: DraftInput = {
        title,
        intro,
        depositPct: Number(depositPct),
        lines: lines.map((l) => ({
          section: l.section,
          productId: l.productId,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice.replace(/^−/, "-"),
          vatRate: Number(l.vatRate),
          origin: l.origin,
        })),
      };
      if (!Number.isFinite(input.depositPct)) return { error: "Enter the deposit as a percentage." };
      if (input.lines.some((l) => !Number.isFinite(l.quantity) || !Number.isFinite(l.vatRate))) return { error: "Quantities and VAT rates must be numbers." };
      const r = await saveProposalDraftAction(proposalId, input);
      router.refresh();
      return r;
    });

  return (
    <section aria-labelledby="editor-title" className="flex flex-col gap-5 rounded-[14px] border bg-card p-6 max-md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="editor-title" className="text-base font-bold">
          Edit draft
        </h2>
        <p className="text-[13px] text-ink-3">Rebuilding from the design replaces the lines marked “From the design”; lines you add are kept.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <div className="grid gap-1.5">
          <Label htmlFor="pr-title">Title</Label>
          <Input id="pr-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pr-deposit">Deposit (%)</Label>
          <Input id="pr-deposit" inputMode="decimal" value={depositPct} onChange={(e) => setDepositPct(e.target.value)} />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="pr-intro">Introduction (optional)</Label>
          <Textarea id="pr-intro" rows={3} value={intro} onChange={(e) => setIntro(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Proposal lines</caption>
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="pb-2 font-semibold">Section</th>
              <th className="pb-2 font-semibold">Description</th>
              <th className="w-20 pb-2 font-semibold">Qty</th>
              <th className="w-28 pb-2 font-semibold">Unit price (£)</th>
              <th className="w-20 pb-2 font-semibold">VAT %</th>
              <th className="w-24 pb-2 text-right font-semibold">Total</th>
              <th className="w-28 pb-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const total = lineTotal(parsed[i]!);
              const n = i + 1;
              return (
                <tr key={l.key} className="border-t align-top" data-testid="proposal-line">
                  <td className="py-2 pr-2">
                    <Select aria-label={`Line ${n} section`} value={l.section} onChange={(e) => update(l.key, { section: e.target.value as ProposalSection })} className="h-9">
                      {SECTIONS.map((s) => (
                        <option key={s} value={s}>
                          {SECTION_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-2 pr-2">
                    <Input aria-label={`Line ${n} description`} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} className="h-9" />
                    {l.origin === "design" && <span className="text-xs text-muted-foreground">From the design</span>}
                  </td>
                  <td className="py-2 pr-2">
                    <Input aria-label={`Line ${n} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} className="h-9" />
                  </td>
                  <td className="py-2 pr-2">
                    <Input aria-label={`Line ${n} unit price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} className="h-9" />
                  </td>
                  <td className="py-2 pr-2">
                    <Input aria-label={`Line ${n} VAT rate`} inputMode="decimal" value={l.vatRate} onChange={(e) => update(l.key, { vatRate: e.target.value })} className="h-9" />
                  </td>
                  <td className="py-2 pr-2 pt-4 text-right font-medium">{formatPence(total)}</td>
                  <td className="py-2">
                    <div className="flex justify-end gap-1">
                      <Button type="button" size="icon" variant="ghost" aria-label={`Move line ${n} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Move line ${n} down`} disabled={i === lines.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Remove line ${n}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setLines((ls) => [
              ...ls,
              { key: crypto.randomUUID(), section: "installation", productId: null, description: "", quantity: "1", unitPrice: "", vatRate: labourVat === null ? "" : String(labourVat), origin: "custom" },
            ])
          }
        >
          <Plus className="size-4" aria-hidden /> Add line
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 border-t pt-4">
        <dl className="flex gap-6 text-sm" aria-live="polite">
          <div>
            <dt className="text-ink-3">Subtotal</dt>
            <dd className="font-semibold">{formatPence(totals.subtotalPence)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">VAT</dt>
            <dd className="font-semibold">{formatPence(totals.vatPence)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Total</dt>
            <dd className="font-semibold">{formatPence(totals.totalPence)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Deposit</dt>
            <dd className="font-semibold">{formatPence(totals.depositPence)}</dd>
          </div>
        </dl>
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save draft"}
        </Button>
      </div>
      <FormMessage state={state} />
    </section>
  );
}

export function ResendBalanceButton({ invoiceId }: { invoiceId: string }) {
  const { pending, state, run } = useRun();
  return (
    <div className="flex flex-col">
      <Button variant="outline" disabled={pending} onClick={() => run(() => resendBalanceInvoiceAction(invoiceId))}>
        {pending ? "Sending…" : "Email invoice again"}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}
