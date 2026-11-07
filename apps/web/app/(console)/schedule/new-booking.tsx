"use client";

import { bookingTitle, installBookingTypes, type LengthUnit } from "@goinstall/core";
import { Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { BookingInvite, INVITE_LABELS, type InviteType } from "@/components/booking-invite";
import { PRODUCTS, productLabel } from "@/components/domain";
import { FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { newProjectForBookingAction } from "@/lib/actions/bookings";
import { cn } from "@/lib/utils";

export interface BookableProject {
  id: string;
  customer: string;
  address: string | null;
  products: string[];
  length: { value: number; unit: LengthUnit } | null;
}

export interface BookableCustomer {
  id: string;
  name: string;
  company: string | null;
  place: string | null;
  projects: BookableProject[];
}

interface People {
  teams: { id: string; name: string; members: string[] }[];
  users: { id: string; full_name: string; role: string }[];
}

type Option = { kind: "project"; customer: BookableCustomer; project: BookableProject } | { kind: "new"; customer: BookableCustomer };

/**
 * "New booking" on the Schedule page: find the customer, pick one of their
 * projects or start a new one, then book it like a calendar invite (the same
 * form as the project's Schedule tab).
 */
export function NewBookingButton({ customers, people, date }: { customers: BookableCustomer[]; people: People; date: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [project, setProject] = useState<BookableProject | null>(null);
  const [creating, setCreating] = useState<BookableCustomer | null>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length
    ? customers.filter((c) => words.every((w) => `${c.name} ${c.company ?? ""} ${c.place ?? ""} ${c.projects.map((p) => p.address ?? "").join(" ")}`.toLowerCase().includes(w))).slice(0, 6)
    : [];
  const options: Option[] = found.flatMap((c) => [...c.projects.map((p) => ({ kind: "project" as const, customer: c, project: p })), { kind: "new" as const, customer: c }]);
  const choose = (o: Option) => (o.kind === "project" ? setProject(o.project) : setCreating(o.customer));
  const open = () => {
    setProject(null);
    setCreating(null);
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
          ) : creating ? (
            <NewProject
              customer={creating}
              onBack={() => setCreating(null)}
              onCreated={(p) => {
                setCreating(null);
                setProject(p);
              }}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <label htmlFor="nb-search" className="text-sm font-medium">
                Customer
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" aria-hidden />
                <input
                  id="nb-search"
                  role="combobox"
                  aria-expanded={options.length > 0}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
                  value={q}
                  autoFocus
                  placeholder="Search by customer name or address"
                  onChange={(e) => {
                    setQ(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActive((a) => Math.min(a + 1, options.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((a) => Math.max(a - 1, 0));
                    } else if (e.key === "Enter" && options[active]) {
                      e.preventDefault();
                      choose(options[active]!);
                    }
                  }}
                  className="h-10 w-full rounded-md border border-input bg-card pr-3 pl-8 text-sm"
                />
              </div>
              {words.length > 0 && (
                <ul id={listId} role="listbox" aria-label="Customers and projects" className="flex flex-col rounded-md border">
                  {found.length === 0 && <li className="px-3 py-3 text-sm text-ink-3">No customers match.</li>}
                  {found.map((c) => (
                    <li key={c.id} role="presentation" className="border-b last:border-b-0">
                      <p className="px-3 pt-2.5 pb-1 text-xs font-bold tracking-[0.04em] text-ink-3 uppercase">
                        {c.name}
                        {c.company ? ` · ${c.company}` : ""}
                        {c.place ? ` · ${c.place}` : ""}
                      </p>
                      <ul role="group" aria-label={c.name}>
                        {options.map((o, i) =>
                          o.customer.id !== c.id ? null : (
                            <li
                              key={o.kind === "project" ? o.project.id : `new-${c.id}`}
                              id={`${listId}-${i}`}
                              role="option"
                              aria-selected={i === active}
                              onClick={() => choose(o)}
                              onMouseEnter={() => setActive(i)}
                              className={cn("cursor-pointer px-3 py-2 text-sm", i === active && "bg-accent-tint", o.kind === "new" && "font-semibold text-primary")}
                            >
                              {o.kind === "project" ? (
                                <>
                                  {o.project.products.map((p) => productLabel(p as (typeof PRODUCTS)[number])).join(", ") || "Project"}
                                  <span className="block text-xs text-ink-3">{o.project.address ?? "No site address"}</span>
                                </>
                              ) : (
                                `+ New project for ${c.name}`
                              )}
                            </li>
                          ),
                        )}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[13px] text-ink-3">
                New customer?{" "}
                <Link href="/contacts/new" className="font-semibold text-primary underline">
                  Add them as an enquiry
                </Link>{" "}
                first.
              </p>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}

/** Start a project for the customer at their address, then carry on booking it. */
function NewProject({ customer, onBack, onCreated }: { customer: BookableCustomer; onBack: () => void; onCreated: (p: BookableProject) => void }) {
  const [products, setProducts] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-md bg-surface-subtle px-3 py-2 text-sm">
        <span>
          New project for <span className="font-semibold">{customer.name}</span>
          {customer.place ? ` · ${customer.place}` : ""}
        </span>
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          Change
        </Button>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Products</legend>
        <div className="flex flex-wrap gap-4">
          {PRODUCTS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={products.includes(p)} onChange={(e) => setProducts((ps) => (e.target.checked ? [...ps, p] : ps.filter((x) => x !== p)))} className="size-4 accent-primary" />
              {productLabel(p)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="nb-desc" className="text-sm font-medium">
          Work description (optional)
        </label>
        <textarea id="nb-desc" rows={2} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Replace consumer unit; EICR" className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
        <p className="text-xs text-ink-3">Uses the customer&apos;s address as the site address; you can change it on the project.</p>
      </div>
      <div>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await newProjectForBookingAction({ contactId: customer.id, products: products as ("solar" | "battery" | "ev" | "electrical")[], workDescription: description });
              if (r.project) onCreated(r.project);
              else setError(r.error);
            })
          }
        >
          {pending ? "Creating…" : "Create project and book"}
        </Button>
      </div>
      <FormMessage state={{ error }} />
    </div>
  );
}
