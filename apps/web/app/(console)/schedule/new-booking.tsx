"use client";

import { bookingTitle, installBookingTypes, type LengthUnit } from "@goinstall/core";
import { Plus, Search, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { BookingInvite, INVITE_LABELS, type InviteType } from "@/components/booking-invite";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BookableProject {
  id: string;
  customer: string;
  address: string | null;
  products: string[];
  length: { value: number; unit: LengthUnit } | null;
}

interface People {
  teams: { id: string; name: string; members: string[] }[];
  users: { id: string; full_name: string; role: string }[];
}

/**
 * "New booking" on the Schedule page: pick the project, then book it like a
 * calendar invite (the same form as the project's Schedule tab).
 */
export function NewBookingButton({ projects, people, date }: { projects: BookableProject[]; people: People; date: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [project, setProject] = useState<BookableProject | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = projects.filter((p) => words.every((w) => `${p.customer} ${p.address ?? ""}`.toLowerCase().includes(w))).slice(0, 8);
  const open = () => {
    setProject(null);
    setQ("");
    ref.current?.showModal();
  };
  const types: InviteType[] = project ? [...installBookingTypes(project.products), "survey", "task"] : [];
  const titles = Object.fromEntries((Object.keys(INVITE_LABELS) as InviteType[]).map((t) => [t, t === "task" ? "Site visit" : bookingTitle(t, project?.products ?? [])])) as Record<InviteType, string>;

  return (
    <>
      <Button onClick={open}>
        <Plus className="size-4" aria-hidden /> New booking
      </Button>
      <dialog ref={ref} aria-labelledby="new-booking-title" className="m-auto max-h-[calc(100dvh-32px)] w-[min(680px,calc(100vw-32px))] overflow-y-auto rounded-xl border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id="new-booking-title" className="text-lg font-bold">
            New booking
          </h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded-md p-1 text-ink-3 hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 p-5">
          {project ? (
            <>
              <div className="flex items-center justify-between gap-3 rounded-md bg-surface-subtle px-3 py-2 text-sm">
                <span>
                  <span className="font-semibold">{project.customer}</span>
                  {project.address ? ` · ${project.address}` : ""}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setProject(null)}>
                  Change
                </Button>
              </div>
              <BookingInvite key={project.id} projectId={project.id} prefix="nb-" types={types} defaultTitles={titles} address={project.address} people={people} projectLength={project.length} initialType="install" defaultDate={date} />
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <label htmlFor="nb-project" className="text-sm font-medium">
                Which job?
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" aria-hidden />
                <input
                  id="nb-project"
                  role="combobox"
                  aria-expanded
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
                  value={q}
                  autoFocus
                  placeholder="Customer name or address"
                  onChange={(e) => {
                    setQ(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActive((a) => Math.min(a + 1, matches.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((a) => Math.max(a - 1, 0));
                    } else if (e.key === "Enter" && matches[active]) {
                      e.preventDefault();
                      setProject(matches[active]!);
                    }
                  }}
                  className="h-10 w-full rounded-md border border-input bg-card pr-3 pl-8 text-sm"
                />
              </div>
              <ul id={listId} role="listbox" aria-label="Projects" className="flex flex-col divide-y rounded-md border">
                {matches.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-ink-3">No projects match.</li>
                ) : (
                  matches.map((p, i) => (
                    <li
                      key={p.id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onClick={() => setProject(p)}
                      onMouseEnter={() => setActive(i)}
                      className={cn("cursor-pointer px-3 py-2.5 text-sm", i === active && "bg-accent-tint")}
                    >
                      <span className="font-semibold">{p.customer}</span>
                      <span className="block text-xs text-ink-3">{[p.address, p.products.join(", ")].filter(Boolean).join(" · ") || "No site address"}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
