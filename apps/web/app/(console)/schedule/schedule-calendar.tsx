"use client";

import type { CalendarView } from "@goinstall/core";
import { AlertTriangle, ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ActionForm, FormMessage, SubmitButton, type FormState } from "@/components/forms";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { notifyBookingCustomerAction, rescheduleBookingAction } from "@/lib/actions/bookings";
import { cn } from "@/lib/utils";

export interface CalendarEvent {
  id: string;
  type: "survey" | "install" | "scaffold_up" | "scaffold_down" | "task";
  title: string;
  customer: string | null;
  address: string | null;
  projectId: string | null;
  /** Each UK date the booking covers. */
  dates: string[];
  allDay: boolean;
  time: string | null;
  startTime: string | null;
  people: { role: string; name: string }[];
  teamId: string | null;
  status: string;
  notifiedAt: string | null;
  confirmedAt: string | null;
  clash: boolean;
  notes: string | null;
  responses: { name: string; response: "accepted" | "declined"; reason: string | null }[];
}

const TONES: Record<CalendarEvent["type"], string> = {
  install: "border-l-primary bg-accent-tint text-accent-deep",
  survey: "border-l-info bg-info-tint text-info-text",
  scaffold_up: "border-l-warning bg-warning-tint text-warning-text",
  scaffold_down: "border-l-warning bg-warning-tint text-warning-text",
  task: "border-l-ink-3 bg-muted text-foreground",
};
const LEGEND: [CalendarEvent["type"], string][] = [
  ["install", "Installation"],
  ["survey", "Survey"],
  ["scaffold_up", "Scaffold"],
  ["task", "Task"],
];
const ROLE_LABELS: Record<string, string> = { team: "Team", electrician: "Electrician", scaffolder: "Scaffolder", surveyor: "Surveyor" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const day = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
const byTime = (a: CalendarEvent, b: CalendarEvent) => (a.allDay === b.allDay ? (a.startTime ?? "").localeCompare(b.startTime ?? "") : a.allDay ? -1 : 1);

/**
 * The Schedule calendar: day, week or month, filtered by team. Clicking a
 * booking opens its details, with Reschedule and Notify customer.
 */
export function ScheduleCalendar({
  view,
  date,
  today,
  range,
  events,
  teams,
  team,
}: {
  view: CalendarView;
  date: string;
  today: string;
  range: { from: string; to: string; days: string[]; prev: string; next: string };
  events: CalendarEvent[];
  teams: { id: string; name: string }[];
  team: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  // Keep showing the open booking while the calendar follows it to new dates.
  const last = useRef<CalendarEvent | null>(null);
  const found = events.find((e) => e.id === openId) ?? null;
  if (found) last.current = found;
  const open = openId ? (found ?? last.current) : null;

  const href = (o: { view?: CalendarView; date?: string; team?: string | null }) => {
    const p = new URLSearchParams(params.toString());
    p.delete("week");
    p.set("view", o.view ?? view);
    p.set("date", o.date ?? date);
    const t = o.team === undefined ? team : o.team;
    if (t) p.set("team", t);
    else p.delete("team");
    return `${pathname}?${p}`;
  };
  const on = (d: string) => events.filter((e) => e.dates.includes(d)).sort(byTime);
  const heading =
    view === "day" ? day(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : view === "week" ? `Week of ${day(range.from, { day: "numeric", month: "long", year: "numeric" })}` : day(date, { month: "long", year: "numeric" });
  const clashes = events.filter((e) => e.clash).length;

  return (
    <section aria-labelledby="calendar-heading" className="flex flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <nav aria-label="Dates" className="flex items-center gap-1.5">
          <Link href={href({ date: range.prev })} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Previous ${view}`}>
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <Link href={href({ date: today })} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Today
          </Link>
          <Link href={href({ date: range.next })} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`Next ${view}`}>
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </nav>
        <h2 id="calendar-heading" className="text-[17px] font-bold">
          {heading}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-2">
            Team
            <Select value={team ?? ""} onChange={(e) => router.push(href({ team: e.target.value || null }))} className="h-9 w-auto">
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
          <nav aria-label="Calendar view" className="flex rounded-md border p-0.5">
            {(["day", "week", "month"] as const).map((v) => (
              <Link
                key={v}
                href={href({ view: v })}
                aria-current={v === view ? "page" : undefined}
                className={cn("rounded-[5px] px-3 py-1.5 text-sm font-semibold text-ink-2 capitalize hover:bg-muted", v === view && "bg-accent-tint text-accent-strong hover:bg-accent-tint")}
              >
                {v}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {clashes > 0 && (
        <p role="alert" className="flex items-center gap-2 border-b bg-warning-tint px-4 py-2 text-sm font-semibold text-warning-text">
          <AlertTriangle className="size-4" aria-hidden />
          {clashes} booking{clashes === 1 ? " is" : "s are"} double-booked here: look for the orange outline.
        </p>
      )}

      {view === "month" ? (
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">Bookings in {heading}</caption>
          <thead>
            <tr>
              {WEEKDAYS.map((w) => (
                <th key={w} scope="col" className="border-b py-2 text-xs font-semibold text-ink-3 uppercase">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: range.days.length / 7 }, (_, r) => (
              <tr key={r}>
                {range.days.slice(r * 7, r * 7 + 7).map((d) => {
                  const list = on(d);
                  const inMonth = d.slice(0, 7) === date.slice(0, 7);
                  return (
                    <td key={d} className={cn("h-28 border-r border-b p-1.5 align-top last:border-r-0", !inMonth && "bg-surface-subtle")}>
                      <Link
                        href={href({ view: "day", date: d })}
                        className={cn("mb-1 inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold", d === today ? "bg-primary text-primary-foreground" : inMonth ? "text-foreground hover:bg-muted" : "text-muted-foreground")}
                        aria-label={`${day(d, { weekday: "long", day: "numeric", month: "long" })}, ${list.length} booking${list.length === 1 ? "" : "s"}`}
                      >
                        {Number(d.slice(8))}
                      </Link>
                      <div className="flex flex-col gap-1">
                        {list.slice(0, 3).map((e) => (
                          <EventChip key={e.id} e={e} compact onOpen={setOpenId} />
                        ))}
                        {list.length > 3 && (
                          <Link href={href({ view: "day", date: d })} className="px-1 text-xs font-semibold text-primary">
                            +{list.length - 3} more
                          </Link>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : view === "week" ? (
        <div className="grid grid-cols-7 max-lg:grid-cols-1">
          {range.days.map((d) => {
            const list = on(d);
            return (
              <section key={d} aria-label={day(d, { weekday: "long", day: "numeric", month: "long" })} className={cn("flex min-h-64 min-w-0 flex-col gap-1.5 border-r p-2 last:border-r-0 max-lg:min-h-0 max-lg:border-r-0 max-lg:border-b", ["6", "0"].includes(String(new Date(`${d}T12:00:00Z`).getUTCDay())) && "bg-surface-subtle")}>
                <Link href={href({ view: "day", date: d })} className="mb-1 flex items-baseline gap-1.5 rounded px-1 hover:bg-muted">
                  <span className="text-xs font-semibold text-ink-3 uppercase">{day(d, { weekday: "short" })}</span>
                  <span className={cn("text-lg font-bold", d === today && "text-primary")}>{Number(d.slice(8))}</span>
                </Link>
                {list.map((e) => (
                  <EventChip key={e.id} e={e} onOpen={setOpenId} />
                ))}
                {!list.length && <span className="px-1 text-xs text-muted-foreground max-lg:hidden">—</span>}
              </section>
            );
          })}
        </div>
      ) : (
        <ul className="flex flex-col gap-2 p-4">
          {on(date).map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => setOpenId(e.id)} className={cn("flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border-l-4 px-4 py-3 text-left", TONES[e.type], e.clash && "ring-2 ring-warning")}>
                <span className="w-28 shrink-0 text-sm font-semibold">{e.time ?? (e.dates.length > 1 ? `Day ${e.dates.indexOf(date) + 1} of ${e.dates.length}` : "All day")}</span>
                <span className="font-semibold">{e.title}</span>
                <span className="text-sm">{[e.customer, e.address].filter(Boolean).join(" · ")}</span>
                {e.people.length > 0 && <span className="text-sm opacity-80">{e.people.map((p) => p.name).join(", ")}</span>}
              </button>
            </li>
          ))}
          {!on(date).length && <li className="py-8 text-center text-sm text-muted-foreground">Nothing booked{team ? " for this team" : ""}.</li>}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t px-4 py-2.5 text-xs text-ink-3">
        {LEGEND.map(([t, label]) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className={cn("size-3 rounded-[3px] border-l-4", TONES[t])} aria-hidden />
            {label}
          </span>
        ))}
      </div>

      <EventDetails e={open} teams={teams} onClose={() => setOpenId(null)} onMoved={(d) => router.push(href({ date: d }))} />
    </section>
  );
}

function EventChip({ e, compact, onOpen }: { e: CalendarEvent; compact?: boolean; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(e.id)}
      className={cn("w-full min-w-0 rounded-[6px] border-l-4 px-2 text-left leading-snug", compact ? "py-0.5 text-xs" : "py-1.5 text-[13px]", TONES[e.type], e.clash && "ring-2 ring-warning")}
    >
      <span className="block truncate font-semibold">
        {e.responses.some((r) => r.response === "declined") ? (
          <span className="text-destructive" title="Declined by an installer">
            ✕<span className="sr-only">Declined:</span>{" "}
          </span>
        ) : e.responses.length > 0 ? (
          <span title="Accepted">
            ✓<span className="sr-only">Accepted:</span>{" "}
          </span>
        ) : null}
        {e.startTime && <span className="font-normal">{e.startTime} </span>}
        {e.title}
      </span>
      {!compact && (e.customer || e.address) && <span className="block truncate">{[e.customer, e.address].filter(Boolean).join(" · ")}</span>}
      {!compact && e.people.length > 0 && <span className="block truncate opacity-80">{e.people.map((p) => p.name).join(", ")}</span>}
    </button>
  );
}

/** The booking's details in a dialog (Escape or Close shuts it), with Reschedule and Notify customer. */
function EventDetails({ e, teams, onClose, onMoved }: { e: CalendarEvent | null; teams: { id: string; name: string }[]; onClose: () => void; onMoved: (date: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState<FormState>({});
  const [pending, start] = useTransition();
  const id = e?.id ?? null;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (id && !d.open) d.showModal();
    if (!id && d.open) d.close();
    setNotice({});
  }, [id]);

  const fmt = (d: string) => day(d, { weekday: "short", day: "numeric", month: "short" });
  const when = e ? (e.dates.length > 1 ? `${fmt(e.dates[0]!)} to ${fmt(e.dates.at(-1)!)} (${e.dates.length} days)` : `${fmt(e.dates[0]!)}${e.time ? `, ${e.time}` : ", all day"}`) : "";

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="event-title" className="m-auto w-[min(520px,calc(100vw-32px))] rounded-xl border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/40">
      {e && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <span className={cn("mt-1 size-3 shrink-0 rounded-[3px] border-l-4", TONES[e.type])} aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 id="event-title" className="text-lg font-bold">
                {e.title}
              </h2>
              <p className="text-sm text-ink-3">{when}</p>
            </div>
            <button type="button" onClick={() => ref.current?.close()} className="rounded-md p-1 hover:bg-muted" aria-label="Close">
              <X className="size-5" aria-hidden />
            </button>
          </div>

          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-sm">
            {e.customer && (
              <>
                <dt className="text-ink-3">Customer</dt>
                <dd className="font-medium">{e.customer}</dd>
              </>
            )}
            {e.address && (
              <>
                <dt className="text-ink-3">Address</dt>
                <dd>{e.address}</dd>
              </>
            )}
            {e.people.map((p, i) => (
              <span key={i} className="contents">
                <dt className="text-ink-3">{ROLE_LABELS[p.role] ?? p.role}</dt>
                <dd>{p.name}</dd>
              </span>
            ))}
            {e.people.length > 0 && (
              <>
                <dt className="text-ink-3">Installers</dt>
                <dd>
                  {e.responses.length ? (
                    <ul>
                      {e.responses.map((r, i) => (
                        <li key={i} className={r.response === "declined" ? "font-semibold text-destructive" : "text-success"}>
                          {r.name}: {r.response === "accepted" ? "accepted" : `declined (${r.reason})`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">Waiting for them to accept in the app</span>
                  )}
                </dd>
              </>
            )}
            <dt className="text-ink-3">Customer told</dt>
            <dd>{e.confirmedAt ? "Confirmed the dates" : e.notifiedAt ? `Sent ${new Date(e.notifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Not yet"}</dd>
            {e.notes && (
              <>
                <dt className="text-ink-3">Notes</dt>
                <dd className="whitespace-pre-line">{e.notes}</dd>
              </>
            )}
          </dl>
          {e.clash && (
            <p className="flex items-center gap-2 rounded-md bg-warning-tint px-3 py-2 text-sm font-semibold text-warning-text">
              <AlertTriangle className="size-4" aria-hidden /> Someone on this booking is double-booked.
            </p>
          )}

          <ActionForm
            key={e.id}
            action={async (prev, form) => {
              const r = await rescheduleBookingAction(e.id, prev, form);
              if (!r.error) onMoved(String(form.get("date")));
              return r;
            }}
            className="flex flex-col gap-3 rounded-lg border p-3"
          >
            <h3 className="text-sm font-bold">Reschedule</h3>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={e.dates.length > 1 ? "New first day" : "New date"} htmlFor="rs-date">
                <Input id="rs-date" name="date" type="date" defaultValue={e.dates[0]} required className="w-44" />
              </Field>
              {!e.allDay && (
                <Field label="Time" htmlFor="rs-time">
                  <Input id="rs-time" name="time" type="time" defaultValue={e.startTime ?? ""} className="w-32" />
                </Field>
              )}
              {e.type === "install" && teams.length > 0 && (
                <Field label="Team" htmlFor="rs-team">
                  <Select id="rs-team" name="team_id" defaultValue={e.teamId ?? ""} className="w-48">
                    <option value="">No team</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <SubmitButton pendingText="Moving…">Move</SubmitButton>
            </div>
          </ActionForm>

          <div className="flex flex-wrap items-center gap-2">
            {e.projectId && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setNotice(await notifyBookingCustomerAction(e.id));
                  })
                }
              >
                {pending ? "Sending…" : "Notify customer"}
              </Button>
            )}
            {e.projectId && (
              <Link href={`/projects/${e.projectId}/install`} className={buttonVariants({ variant: "ghost" })}>
                Open project
              </Link>
            )}
          </div>
          <FormMessage state={notice} />
        </div>
      )}
    </dialog>
  );
}
