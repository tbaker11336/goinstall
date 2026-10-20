"use client";

import { CONTACT_STAGE_LABELS, CONTACT_STAGES, type ContactStage } from "@goinstall/core";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ProductTags, type Product } from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { moveContactAction } from "@/lib/actions/crm";
import { cn } from "@/lib/utils";

export interface KanbanContact {
  id: string;
  name: string;
  town: string | null;
  postcode: string | null;
  source: string | null;
  stage: ContactStage;
  interested_in: Product[];
  status: string | null;
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
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}
      <div className="grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-4">
        {CONTACT_STAGES.map((stage) => {
          const cards = optimistic.filter((c) => c.stage === stage);
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
              className={cn("flex min-h-64 flex-col rounded-lg bg-muted p-2 transition-colors", dragOver === stage && "bg-secondary ring-2 ring-primary")}
            >
              <h2 id={`col-${stage}`} className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {CONTACT_STAGE_LABELS[stage]}
                <span className="tabular-nums">{cards.length}</span>
              </h2>
              <ul className="grid gap-2">
                {cards.map((c) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/contact-id", c.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="cursor-grab rounded-md border bg-card p-3 text-sm shadow-xs active:cursor-grabbing"
                    data-testid="kanban-card"
                  >
                    <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{[c.town, c.postcode].filter(Boolean).join(" · ") || "No address"}</p>
                    <ProductTags products={c.interested_in} className="my-2" />
                    {c.source && <p className="text-xs text-muted-foreground">Source: {c.source}</p>}
                    {c.status && <p className="mt-1 line-clamp-2 text-xs">{c.status}</p>}
                    <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="sr-only">Move {c.name} to</span>
                      <span aria-hidden>Move to</span>
                      <select
                        value={c.stage}
                        onChange={(e) => move(c, e.target.value as ContactStage)}
                        className="h-7 flex-1 rounded border border-input bg-card px-1 text-xs text-foreground"
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
