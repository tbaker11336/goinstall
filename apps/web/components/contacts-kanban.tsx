"use client";

import { CONTACT_STAGE_LABELS, CONTACT_STAGES, type ContactStage } from "@goinstall/core";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Avatar, ProductTags, stageDotClass, type Product } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { moveContactAction } from "@/lib/actions/crm";
import { cn, formatMoney, timeAgo } from "@/lib/utils";

export interface KanbanContact {
  id: string;
  name: string;
  town: string | null;
  postcode: string | null;
  source: string | null;
  stage: ContactStage;
  interested_in: Product[];
  status: string | null;
  value: string | null;
  owner_name: string | null;
  last_activity_at: Date;
}

/** "£42k" style column totals. */
function compactMoney(total: number) {
  if (!total) return "";
  return total >= 1000 ? `£${Math.round(total / 1000)}k` : formatMoney(total);
}

/** Postcode district ("OX16") for the card's location line. */
function district(postcode: string | null) {
  return postcode?.trim().split(/\s+/)[0]?.toUpperCase() ?? null;
}

export function ContactsKanban({ contacts }: { contacts: KanbanContact[] }) {
  // Stages the user has set on this page. They win over the server-rendered
  // props until those catch up, so a refresh from an earlier move that lands
  // late can't put a card back in its old column.
  const [overrides, setOverrides] = useState<Record<string, ContactStage>>({});
  useEffect(() => {
    setOverrides((o) => {
      const stale = Object.entries(o).filter(([id, stage]) => contacts.find((c) => c.id === id)?.stage !== stage);
      return stale.length === Object.keys(o).length ? o : Object.fromEntries(stale);
    });
  }, [contacts]);
  const optimistic = contacts.map((c) => (overrides[c.id] ? { ...c, stage: overrides[c.id]! } : c));
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<ContactStage | null>(null);
  const [lostFor, setLostFor] = useState<KanbanContact | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  function move(contact: KanbanContact, stage: ContactStage, reason?: string) {
    if (stage === contact.stage) return;
    if (stage === "lost" && !reason) {
      setLostFor(contact);
      dialogRef.current?.showModal();
      return;
    }
    setError(null);
    const previous = contact.stage;
    setOverrides((o) => ({ ...o, [contact.id]: stage }));
    startTransition(async () => {
      const result = await moveContactAction(contact.id, stage, reason);
      if (result.error) {
        setError(`${contact.name}: ${result.error}`);
        setOverrides((o) => ({ ...o, [contact.id]: previous }));
      } else if (result.stage) {
        setOverrides((o) => ({ ...o, [contact.id]: result.stage as ContactStage }));
      }
    });
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="flex items-start gap-3.5 overflow-x-auto pb-2">
        {CONTACT_STAGES.map((stage) => {
          const cards = optimistic.filter((c) => c.stage === stage);
          const total = stage === "lost" ? 0 : cards.reduce((n, c) => n + Number(c.value ?? 0), 0);
          return (
            <section
              key={stage}
              aria-labelledby={`col-${stage}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(stage);
              }}
              onDragLeave={() => setDragOver((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const contact = optimistic.find((c) => c.id === e.dataTransfer.getData("text/contact-id"));
                if (contact) move(contact, stage);
              }}
              className={cn(
                "flex min-h-40 w-[272px] shrink-0 flex-col gap-2.5 rounded-lg p-3 transition-colors",
                stage === "lost" ? "bg-muted" : "bg-divider",
                dragOver === stage && "bg-accent-tint ring-2 ring-primary",
              )}
            >
              <div className="flex items-center justify-between px-1 pt-0.5 pb-1.5">
                <h2 id={`col-${stage}`} className={cn("flex items-center gap-2 text-sm font-bold", stage === "lost" && "text-ink-3")}>
                  <span className={cn("size-2 rounded-full", stageDotClass(stage))} aria-hidden />
                  {CONTACT_STAGE_LABELS[stage]}
                  <span className="rounded-full bg-card px-2 py-px text-xs font-bold text-ink-3 tabular-nums">{cards.length}</span>
                </h2>
                {total > 0 && <span className="text-[12.5px] font-medium text-ink-3 tabular-nums">{compactMoney(total)}</span>}
              </div>
              <ul className="grid gap-2.5">
                {cards.map((c) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/contact-id", c.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className={cn(
                      "flex cursor-grab flex-col gap-2 rounded-[10px] border bg-card p-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:border-primary active:cursor-grabbing",
                      stage === "lost" && "bg-[#fcfcfd]",
                    )}
                    data-testid="kanban-card"
                  >
                    <Link href={`/contacts/${c.id}`} className={cn("text-sm font-semibold hover:text-primary", stage === "lost" && "text-ink-3")}>
                      {c.name}
                    </Link>
                    <p className="text-[13px] text-ink-3">{[c.town, district(c.postcode)].filter(Boolean).join(" · ") || "No address"}</p>
                    {stage !== "lost" && <ProductTags products={c.interested_in} />}
                    <div className="flex items-center justify-between gap-2">
                      <p className="line-clamp-2 text-[12.5px] text-muted-foreground">
                        {stage === "lost"
                          ? (c.status ?? "Lost")
                          : [c.value ? formatMoney(c.value) : c.source, c.value ? c.status : timeAgo(c.last_activity_at)].filter(Boolean).join(" · ")}
                      </p>
                      {c.owner_name && stage !== "lost" && <Avatar name={c.owner_name} />}
                    </div>
                    <label className="flex items-center gap-2 border-t border-divider pt-2 text-xs text-muted-foreground">
                      <span className="sr-only">Move {c.name} to</span>
                      <span aria-hidden>Move to</span>
                      <select
                        value={c.stage}
                        onChange={(e) => move(c, e.target.value as ContactStage)}
                        className="h-7 flex-1 rounded-md border border-input bg-card px-1 text-xs text-foreground"
                      >
                        {CONTACT_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {CONTACT_STAGE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="lost-title"
        className="m-auto w-full max-w-md rounded-lg border bg-card p-6 shadow-lg backdrop:bg-black/40"
        onClose={() => setLostFor(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
            if (!reason || !lostFor) return;
            move(lostFor, "lost", reason);
            dialogRef.current?.close();
          }}
          className="grid gap-4"
        >
          <h2 id="lost-title" className="text-base font-semibold">
            Mark {lostFor?.name} as lost
          </h2>
          <Field label="Reason" htmlFor="lost-reason">
            <Input id="lost-reason" name="reason" required autoFocus placeholder="e.g. Went with another installer" key={lostFor?.id} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive">
              Mark lost
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
