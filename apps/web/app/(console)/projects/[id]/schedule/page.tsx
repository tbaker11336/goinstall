import { addDays, bookingDates, bookingLength, bookingTitle, installBookingTypes, PAPERWORK_STATUS_LABELS, ukDate, weekStart, type LengthUnit, type PaperworkStatus } from "@goinstall/core";
import { Check, Clock, MapPin, Plus, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookingInvite, INVITE_LABELS, type InviteBooking, type InviteType } from "@/components/booking-invite";
import { TeamChat } from "@/components/team-chat";
import { WeekGrid } from "@/components/week-grid";
import { asUser } from "@/lib/auth";
import { syncPaperwork } from "@/lib/paperwork";
import { loadBookings, loadPeople, type ScheduleBooking } from "@/lib/schedule";
import { gridFor, weekColumns } from "@/lib/schedule-grid";
import { loadChat, markChatRead } from "@/lib/team-chat";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { CancelBookingButton, ConfirmNotifyButton, CustomerConfirmedToggle } from "./schedule-client";

export const metadata = { title: "Schedule" };

const BOOKING_STATUS: Record<string, string> = { tentative: "Pencilled in", confirmed: "Confirmed", in_progress: "In progress", completed: "Completed" };

function Ready({ done, title, detail, action }: { done: boolean; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-b py-3 last:border-b-0">
      <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2", done ? "border-success bg-success text-white" : "border-warning")}>
        {done && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="flex-1 font-semibold">
        {title}
        <span className="sr-only">{done ? " (done)" : " (not yet)"}</span>
      </span>
      <span className={cn("text-right text-sm", done ? "text-ink-3" : "text-warning-text")}>{detail}</span>
      {action}
    </li>
  );
}

const ROLE_LABELS: Record<string, string> = { team: "Install team", engineer: "Engineer", electrician: "Electrician sign-off", scaffolder: "Scaffolder", surveyor: "Surveyor" };

const ukTime = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** "Mon 10 Nov, 09:00–11:00" or "Mon 10 – Wed 12 Nov, all day". */
function whenText(b: ScheduleBooking) {
  const days = bookingDates(b.startsAt, b.endsAt);
  const day = (d: string) => formatDate(d, { weekday: "short", day: "numeric", month: "short" });
  if (!b.allDay) return `${day(days[0]!)}, ${ukTime(b.startsAt)}–${ukTime(b.endsAt)}`;
  return `${days.length > 1 ? `${day(days[0]!)} – ${day(days.at(-1)!)}` : day(days[0]!)}, all day`;
}

function inviteFor(b: ScheduleBooking): InviteBooking {
  const one = (role: string) => b.assignments.find((a) => a.role === role);
  return {
    id: b.id,
    type: b.type,
    title: b.title,
    startDate: bookingDates(b.startsAt, b.endsAt)[0]!,
    startTime: b.allDay ? "" : ukTime(b.startsAt),
    length: bookingLength(b),
    notes: b.notes,
    teamId: one("team")?.teamId ?? null,
    electricianId: one("electrician")?.userId ?? null,
    scaffolderId: one("scaffolder")?.userId ?? null,
    surveyorId: one("surveyor")?.userId ?? null,
    engineerIds: b.assignments.filter((a) => a.role === "engineer" && a.userId).map((a) => a.userId!),
  };
}

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ week?: string }> }) {
  const { id } = await params;
  const { week } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await asUser(async (tx, session) => {
    const project = await tx.selectFrom("projects").select(["id", "products", "stage", "estimated_length", "estimated_length_unit", "site_address_line1", "site_town", "site_postcode"]).where("id", "=", id).executeTakeFirst();
    if (!project) return null;
    // Keep the paperwork list in step with the bookings (the G99 check below reads it).
    await syncPaperwork(tx, session.companyId, id);
    const g99 = await tx.selectFrom("paperwork_items").select(["status"]).where("project_id", "=", id).where("kind", "=", "g99_application").executeTakeFirst();
    const mine = await loadBookings(tx, { from: "", to: "", projectId: id });
    const install = mine.find((b) => b.type === "install");
    const monday = week && z.iso.date().safeParse(week).success ? weekStart(week) : weekStart(install ? ukDate(install.startsAt) : ukDate(new Date()));
    const [all, people, invoice, orders, solar] = await Promise.all([
      loadBookings(tx, { from: monday, to: addDays(monday, 7) }),
      loadPeople(tx),
      tx.selectFrom("invoices").select(["paid_at"]).where("project_id", "=", id).where("kind", "=", "deposit").where("status", "=", "paid").executeTakeFirst(),
      tx.selectFrom("purchase_orders").select(["status", "expected_date"]).where("project_id", "=", id).where("status", "!=", "cancelled").execute(),
      tx.selectFrom("solar_designs").select(["connection_form"]).where("project_id", "=", id).where("is_active", "=", true).executeTakeFirst(),
    ]);
    const chat = await loadChat(tx, id);
    // Opening the tab counts as reading the team's messages.
    if (chat.length) await markChatRead(tx, id, session.userId);
    return { project, mine, monday, all, people, invoice, orders, solar, g99, chat, me: session.userId };
  });
  if (!data) notFound();
  const { project, mine, monday, all, people, invoice, orders, solar, g99, chat, me } = data;

  const install = mine.find((b) => b.type === "install");
  const { rows, items: gridItems } = gridFor(monday, all, people.teams, { highlightProjectId: id });
  const delivered = orders.filter((o) => o.status === "delivered").length;
  const confirmed = mine.filter((b) => b.type !== "survey" && b.type !== "task").length > 0 && mine.filter((b) => b.type !== "survey" && b.type !== "task").every((b) => b.customerConfirmedAt);
  const lastArrives = orders.filter((o) => o.status !== "delivered" && o.expected_date).map((o) => o.expected_date!).sort().at(-1);

  const types: InviteType[] = [...installBookingTypes(project.products), "survey", "task"];
  const defaultTitles = Object.fromEntries((Object.keys(INVITE_LABELS) as InviteType[]).map((t) => [t, t === "task" ? "Site visit" : bookingTitle(t, project.products)])) as Record<InviteType, string>;
  const address = [project.site_address_line1, project.site_town, project.site_postcode].filter(Boolean).join(", ") || null;
  const projectLength = project.estimated_length && project.estimated_length_unit ? { value: Number(project.estimated_length), unit: project.estimated_length_unit as LengthUnit } : null;
  const sorted = [...mine].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  // Scaffold only appears for solar projects (installBookingTypes).
  const inviteProps = { projectId: id, types, defaultTitles, address, people, projectLength };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">{install ? `Install ${whenText(install)}${install.assignments.find((a) => a.role === "team") ? ` · ${install.assignments.find((a) => a.role === "team")!.name}` : ""}` : "Install not booked yet"}</p>
        {install && <ConfirmNotifyButton projectId={id} done={Boolean(install.customerNotifiedAt)} />}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="bookings-heading" className="flex flex-col gap-3">
            <h2 id="bookings-heading" className="text-base font-bold">
              Bookings
            </h2>
            {sorted.length === 0 && <p className="text-sm text-muted-foreground">Nothing booked yet. Add the install below.</p>}
            {sorted.map((b) => {
              const title = bookingTitle(b.type, b.products, b.title);
              const answer = (name: string) => b.responses.find((r) => r.name === name);
              return (
                <article key={b.id} aria-label={title} className="flex flex-col gap-3 rounded-[12px] border border-l-4 border-l-primary bg-card p-4" data-testid="booking-invite">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold">{title}</h3>
                      <p className="text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase">{INVITE_LABELS[b.type]}</p>
                    </div>
                    <Badge variant={b.status === "tentative" ? "warning" : "success"}>{BOOKING_STATUS[b.status] ?? b.status}</Badge>
                  </div>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    <li className="flex gap-2">
                      <Clock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                      <span>{whenText(b)}</span>
                    </li>
                    {b.address && (
                      <li className="flex gap-2">
                        <MapPin className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                        <span>{b.address}</span>
                      </li>
                    )}
                    <li className="flex gap-2">
                      <Users className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                      {b.assignments.length ? (
                        <ul className="flex flex-wrap gap-1.5" aria-label="Guests">
                          {b.assignments.map((a) => {
                            const r = a.userId ? answer(a.name) : undefined;
                            return (
                              <li key={`${a.role}-${a.teamId ?? a.userId}`} className={cn("rounded-full border px-2.5 py-0.5 text-[13px]", r?.response === "accepted" && "border-success text-success", r?.response === "declined" && "border-red-300 text-red-700")}>
                                {r?.response === "accepted" ? "✓ " : r?.response === "declined" ? "✕ " : ""}
                                {a.name} <span className="text-ink-3">· {ROLE_LABELS[a.role] ?? a.role}</span>
                                {r?.response === "declined" && r.reason ? ` (${r.reason})` : ""}
                                {!r && a.userId ? <span className="text-ink-3"> · waiting</span> : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <span className="text-ink-3">No one invited yet</span>
                      )}
                    </li>
                  </ul>
                  {b.notes && <p className="whitespace-pre-line rounded-md bg-surface-subtle p-3 text-sm">{b.notes}</p>}
                  {b.clashes.length > 0 && (
                    <p role="alert" className="text-sm font-semibold text-warning-text">
                      Double-booked: {b.clashes.length} other booking{b.clashes.length === 1 ? "" : "s"} use the same team or person.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <details className="w-full [&[open]>summary]:mb-3">
                      <summary className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer list-none")}>Edit</summary>
                      <BookingInvite {...inviteProps} prefix={`b-${b.id.slice(0, 8)}-`} booking={inviteFor(b)} />
                    </details>
                    <CancelBookingButton bookingId={b.id} />
                  </div>
                </article>
              );
            })}
          </section>

          <section aria-labelledby="new-booking-heading" className="rounded-[14px] border bg-card p-6 max-md:p-4">
            <h2 id="new-booking-heading" className="mb-4 flex items-center gap-2 text-base font-bold">
              <Plus className="size-4" aria-hidden /> New booking
            </h2>
            <BookingInvite {...inviteProps} prefix="new-" initialType={install ? "task" : "install"} />
          </section>

          <Card>
            <CardHeader className="flex-wrap">
              <CardTitle>Team calendar, week of {formatDate(monday, { day: "numeric", month: "long" })}</CardTitle>
              <nav aria-label="Week" className="flex gap-2">
                <Link href={`?week=${addDays(monday, -7)}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label="Previous week">
                  ‹
                </Link>
                <Link href={`?week=${ukDate(new Date())}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Today
                </Link>
                <Link href={`?week=${addDays(monday, 7)}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label="Next week">
                  ›
                </Link>
              </nav>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <WeekGrid days={weekColumns(monday)} rows={rows} bookings={gridItems} caption={`Team bookings, week of ${monday}`} />
              <p className="text-xs text-muted-foreground">Drag a booking to move it, or use Edit on the booking above.</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Ready to install?</CardTitle>
            </CardHeader>
            <CardContent>
              <ul>
                <Ready done={Boolean(invoice)} title="Deposit paid" detail={invoice?.paid_at ? formatDate(invoice.paid_at, { day: "numeric", month: "short" }) : "Waiting for the deposit"} />
                <Ready
                  done={confirmed}
                  title="Customer confirmed dates"
                  detail={confirmed ? "Confirmed" : install ? (install.customerNotifiedAt ? `Dates sent ${formatDateTime(install.customerNotifiedAt)}` : "Not sent yet") : "Book the install first"}
                  action={install ? <CustomerConfirmedToggle projectId={id} confirmed={confirmed} /> : undefined}
                />
                <Ready
                  done={orders.length > 0 && delivered === orders.length}
                  title="Kit delivered"
                  detail={orders.length ? `${delivered} of ${orders.length} orders${lastArrives ? ` · last arrives ${formatDate(lastArrives, { weekday: "short", day: "numeric", month: "short" })}` : ""}` : "Nothing ordered yet"}
                />
                {solar?.connection_form === "G99" && g99 && (
                  <Ready
                    done={g99.status === "approved" || g99.status === "done"}
                    title="G99 approval from DNO"
                    detail={g99.status === "to_do" ? "Not applied for yet" : g99.status === "approved" || g99.status === "done" ? "Approved" : `${PAPERWORK_STATUS_LABELS[g99.status as PaperworkStatus]}`}
                  />
                )}
              </ul>
            </CardContent>
          </Card>

          <Card id="team-chat">
            <CardHeader className="flex-col items-start">
              <CardTitle>Messages with the team</CardTitle>
              <p className="text-sm text-ink-3">Chat with the installers booked on this job. They see it in the app&apos;s Messages tab; the customer never does.</p>
            </CardHeader>
            <CardContent>
              <TeamChat projectId={id} me={me} messages={chat} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
