import { addDays, BOOKING_TYPE_LABELS, bookingDates, installBookingTypes, PAPERWORK_STATUS_LABELS, TIMING_LABELS, ukDate, weekStart, type PaperworkStatus, type PaperworkTiming } from "@goinstall/core";
import { Check, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { TeamChat } from "@/components/team-chat";
import { WeekGrid } from "@/components/week-grid";
import { saveBookingAction } from "@/lib/actions/bookings";
import { GenerateAllButton } from "@/components/paperwork-client";
import { asUser } from "@/lib/auth";
import { syncPaperwork } from "@/lib/paperwork";
import { signedUrls } from "@/lib/files";
import { loadBookings, loadPeople, type ScheduleBooking } from "@/lib/schedule";
import { gridFor, weekColumns } from "@/lib/schedule-grid";
import { loadChat, markChatRead } from "@/lib/team-chat";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { CancelBookingButton, ConfirmNotifyButton, CustomerConfirmedToggle } from "./install-client";

export const metadata = { title: "Install & paperwork" };

type Kind = "install" | "scaffold_up" | "scaffold_down" | "survey";

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

function BookingForm({
  projectId,
  kind,
  booking,
  teams,
  users,
}: {
  projectId: string;
  kind: Kind;
  booking: ScheduleBooking | undefined;
  teams: { id: string; name: string; members: string[] }[];
  users: { id: string; full_name: string; role: string }[];
}) {
  const days = booking ? bookingDates(booking.startsAt, booking.endsAt) : [];
  const assigned = (role: string) => booking?.assignments.find((a) => a.role === role);
  const p = `${kind}-`;
  return (
    <section aria-labelledby={`${p}title`} className="rounded-[10px] border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 id={`${p}title`} className="text-sm font-bold">
          {BOOKING_TYPE_LABELS[kind]}
        </h3>
        {booking ? <Badge variant={booking.status === "tentative" ? "warning" : "success"}>{BOOKING_STATUS[booking.status] ?? booking.status}</Badge> : <Badge>Not booked</Badge>}
      </div>
      <ActionForm action={saveBookingAction.bind(null, projectId, booking?.id ?? null)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="type" value={kind} />
        <Field label="Start date" htmlFor={`${p}start`}>
          <Input id={`${p}start`} name="start_date" type="date" required defaultValue={days[0] ?? ""} />
        </Field>
        {kind === "survey" ? (
          <>
            <Field label="Time" htmlFor={`${p}time`}>
              <Input id={`${p}time`} name="start_time" type="time" defaultValue={booking && !booking.allDay ? new Date(booking.startsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : ""} />
            </Field>
            <input type="hidden" name="days" value="1" />
          </>
        ) : (
          <Field label="Working days" htmlFor={`${p}days`}>
            <Input id={`${p}days`} name="days" type="number" min={1} max={30} required defaultValue={booking ? days.filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())).length : kind === "install" ? 2 : 1} />
          </Field>
        )}
        {kind === "install" && (
          <>
            <Field label="Install team" htmlFor={`${p}team`}>
              <Select id={`${p}team`} name="team_id" defaultValue={assigned("team")?.teamId ?? ""}>
                <option value="">Choose…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.members.length ? ` · ${t.members.join(", ")}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Electrician sign-off" htmlFor={`${p}elec`}>
              <Select id={`${p}elec`} name="electrician_id" defaultValue={assigned("electrician")?.userId ?? ""}>
                <option value="">Choose…</option>
                {users
                  .filter((u) => u.role !== "subcontractor")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
              </Select>
            </Field>
          </>
        )}
        {(kind === "scaffold_up" || kind === "scaffold_down") && (
          <Field label="Scaffolder" htmlFor={`${p}scaf`} className="lg:col-span-2">
            <Select id={`${p}scaf`} name="scaffolder_id" defaultValue={assigned("scaffolder")?.userId ?? ""}>
              <option value="">Choose…</option>
              {users
                .filter((u) => u.role === "subcontractor")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {kind === "survey" && (
          <Field label="Surveyor" htmlFor={`${p}surveyor`} className="lg:col-span-2">
            <Select id={`${p}surveyor`} name="surveyor_id" defaultValue={assigned("surveyor")?.userId ?? ""}>
              <option value="">Choose…</option>
              {users
                .filter((u) => u.role === "installer" || u.role === "admin" || u.role === "office")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <input type="hidden" name="notes" value={booking?.notes ?? ""} />
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
          <SubmitButton size="sm" variant="outline">
            {booking ? "Update" : "Book"} {BOOKING_TYPE_LABELS[kind].toLowerCase()}
          </SubmitButton>
          {booking && <CancelBookingButton bookingId={booking.id} />}
          {booking?.clashes.length ? (
            <span role="alert" className="text-sm font-semibold text-warning-text">
              Double-booked: {booking.clashes.length} other booking{booking.clashes.length === 1 ? "" : "s"} use the same team or person.
            </span>
          ) : null}
        </div>
      </ActionForm>
    </section>
  );
}

export default async function InstallPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ week?: string }> }) {
  const { id } = await params;
  const { week } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await asUser(async (tx, session) => {
    const project = await tx.selectFrom("projects").select(["id", "products", "stage"]).where("id", "=", id).executeTakeFirst();
    if (!project) return null;
    // Keep the paperwork list in step with the design and bookings.
    await syncPaperwork(tx, session.companyId, id);
    const paperwork = await tx.selectFrom("paperwork_items").select(["id", "kind", "title", "timing", "status", "due_date", "due_note"]).where("project_id", "=", id).orderBy("kind").orderBy("title").execute();
    const mine = await loadBookings(tx, { from: "", to: "", projectId: id });
    const install = mine.find((b) => b.type === "install");
    const monday = week && z.iso.date().safeParse(week).success ? weekStart(week) : weekStart(install ? ukDate(install.startsAt) : ukDate(new Date()));
    const [all, people, invoice, orders, solar, items, signoff] = await Promise.all([
      loadBookings(tx, { from: monday, to: addDays(monday, 7) }),
      loadPeople(tx),
      tx.selectFrom("invoices").select(["paid_at"]).where("project_id", "=", id).where("kind", "=", "deposit").where("status", "=", "paid").executeTakeFirst(),
      tx.selectFrom("purchase_orders").select(["status", "expected_date"]).where("project_id", "=", id).where("status", "!=", "cancelled").execute(),
      tx.selectFrom("solar_designs").select(["connection_form"]).where("project_id", "=", id).where("is_active", "=", true).executeTakeFirst(),
      tx
        .selectFrom("checklist_items as ci")
        .leftJoin("users as u", "u.id", "ci.completed_by")
        .leftJoin("checklist_templates as t", "t.id", "ci.template_id")
        .select(["ci.id", "ci.kind", "ci.product", "ci.title", "ci.done", "ci.serial", "ci.readings", "ci.photo_file_ids", "ci.note", "ci.captured_at", "u.full_name", "t.readings as reading_fields"])
        .where("ci.project_id", "=", id)
        .orderBy("ci.kind")
        .orderBy("ci.captured_at")
        .execute(),
      tx
        .selectFrom("bookings as b")
        .leftJoin("files as f", "f.id", "b.signoff_signature_file_id")
        .select(["b.signoff_name", "b.completed_at", "f.path"])
        .where("b.project_id", "=", id)
        .where("b.completed_at", "is not", null)
        .orderBy("b.completed_at", "desc")
        .executeTakeFirst(),
    ]);
    const photoIds = items.flatMap((i) => i.photo_file_ids);
    const photos = photoIds.length ? await tx.selectFrom("files").select(["id", "path"]).where("id", "in", photoIds).execute() : [];
    const chat = await loadChat(tx, id);
    // Opening the tab counts as reading the team's messages.
    if (chat.length) await markChatRead(tx, id, session.userId);
    return { project, mine, monday, all, people, invoice, orders, solar, items, signoff, photos, paperwork, chat, me: session.userId };
  });
  if (!data) notFound();
  const { project, mine, monday, all, people, invoice, orders, solar, items, signoff, photos, paperwork, chat, me } = data;
  const g99 = paperwork.find((p) => p.kind === "g99_application");
  const started = paperwork.filter((p) => p.status !== "to_do").length;

  const install = mine.find((b) => b.type === "install");
  const { rows, items: gridItems } = gridFor(monday, all, people.teams, { highlightProjectId: id });
  const delivered = orders.filter((o) => o.status === "delivered").length;
  const confirmed = mine.filter((b) => b.type !== "survey").length > 0 && mine.filter((b) => b.type !== "survey").every((b) => b.customerConfirmedAt);
  const lastArrives = orders.filter((o) => o.status !== "delivered" && o.expected_date).map((o) => o.expected_date!).sort().at(-1);
  const urls = await signedUrls([...photos.map((p) => p.path), ...(signoff?.path ? [signoff.path] : [])]);
  const photoUrl = (fid: string) => {
    const f = photos.find((p) => p.id === fid);
    return f ? urls.get(f.path) : null;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">
          {install
            ? `Install ${bookingDates(install.startsAt, install.endsAt)
                .map((d) => formatDate(d, { weekday: "short", day: "numeric", month: "long" }))
                .filter((_, i, a) => i === 0 || i === a.length - 1)
                .join(" – ")}${install.assignments.find((a) => a.role === "team") ? ` · ${install.assignments.find((a) => a.role === "team")!.name}` : ""}`
            : "Not booked yet"}
        </p>
        {install && <ConfirmNotifyButton projectId={id} done={Boolean(install.customerNotifiedAt)} />}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader className="flex-wrap">
              <CardTitle>Week of {formatDate(monday, { day: "numeric", month: "long" })}</CardTitle>
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
            <CardContent className="flex flex-col gap-4">
              <WeekGrid days={weekColumns(monday)} rows={rows} bookings={gridItems} caption={`Team bookings, week of ${monday}`} />
              <p className="text-xs text-muted-foreground">Drag a booking to move it, or change it with the forms below.</p>
              {installBookingTypes(project.products).map((k) => (
                <BookingForm key={k} projectId={id} kind={k} booking={mine.find((b) => b.type === k)} teams={people.teams} users={people.users} />
              ))}
              {(mine.some((b) => b.type === "survey") || project.stage === "survey" || project.stage === "enquiry") && (
                <BookingForm projectId={id} kind="survey" booking={mine.find((b) => b.type === "survey")} teams={people.teams} users={people.users} />
              )}
            </CardContent>
          </Card>

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

          <Card>
            <CardHeader className="flex-col items-start">
              <CardTitle>From the installer app</CardTitle>
              <p className="text-sm text-ink-3">Checklist steps, photos, test readings, serial numbers and the customer&apos;s sign-off, as they sync from the app.</p>
            </CardHeader>
            <CardContent>
              {items.length === 0 && !signoff ? (
                <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                <ul className="divide-y" aria-label="Checklist results">
                  {items.map((i) => {
                    const readings = Object.entries((i.readings ?? {}) as Record<string, string>).filter(([, v]) => v !== "");
                    return (
                      <li key={i.id} className="flex flex-col gap-1.5 py-3" data-testid="checklist-result">
                        <p className="flex items-center gap-2 font-semibold">
                          {i.done ? <Check className="size-4 text-success" aria-label="Done" /> : <span className="size-4 rounded-full border-2 border-warning" aria-label="Not done" />}
                          {i.title}
                          <span className="text-xs font-normal text-muted-foreground">
                            {i.kind === "handover" ? "Handover" : i.product} · {i.full_name ?? "Installer"} · {formatDateTime(i.captured_at)}
                          </span>
                        </p>
                        {i.serial && <p className="text-sm">Serial: {i.serial}</p>}
                        {readings.length > 0 && <p className="text-sm">{readings
                              .map(([k, v]) => {
                                const f = ((i.reading_fields ?? []) as { key: string; label: string; unit: string | null }[]).find((r) => r.key === k);
                                return `${f?.label ?? k.replace(/_/g, " ")}: ${v}${f?.unit ? ` ${f.unit}` : ""}`;
                              })
                              .join(" · ")}</p>}
                        {i.note && <p className="text-sm text-ink-3">{i.note}</p>}
                        {i.photo_file_ids.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {i.photo_file_ids.map((fid) => {
                              const u = photoUrl(fid);
                              // eslint-disable-next-line @next/next/no-img-element
                              return u ? <img key={fid} src={u} alt={`Photo: ${i.title}`} className="size-20 rounded-md object-cover" /> : <span key={fid} className="text-xs text-muted-foreground">Photo uploading…</span>;
                            })}
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {signoff && (
                    <li className="flex flex-col gap-1.5 py-3">
                      <p className="font-semibold">
                        Signed off by {signoff.signoff_name} · {signoff.completed_at ? formatDateTime(signoff.completed_at) : ""}
                      </p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {signoff.path && urls.get(signoff.path) && <img src={urls.get(signoff.path)!} alt={`Signature of ${signoff.signoff_name}`} className="h-20 w-auto rounded-md border bg-white" />}
                    </li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-col items-start">
            <div className="flex w-full items-baseline justify-between gap-2">
              <CardTitle>Paperwork</CardTitle>
              {paperwork.length > 0 && <span className="text-[13px] text-ink-3">{started} of {paperwork.length} started</span>}
            </div>
            <p className="text-sm text-ink-3">Pre-filled from the survey, design and install.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {paperwork.length === 0 ? (
              <p className="text-sm text-muted-foreground">Items appear once the design is saved and the install is booked.</p>
            ) : (
              <ul className="divide-y" aria-label="Paperwork items">
                {paperwork.map((p) => {
                  const status = p.status as PaperworkStatus;
                  const overdue = p.due_date && status === "to_do" && p.due_date.getTime() < Date.now() - 86_400_000;
                  return (
                    <li key={p.id}>
                      <Link href={`/projects/${id}/install/paperwork/${p.id}`} className="flex items-center gap-3 py-3 hover:bg-surface-subtle">
                        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-surface-subtle">
                          <FileText className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{p.title}</span>
                          <span className={cn("text-[13px]", overdue ? "font-semibold text-red-700" : "text-ink-3")}>
                            {p.due_date ? `Due ${formatDate(p.due_date, { day: "numeric", month: "short" })}` : TIMING_LABELS[p.timing as PaperworkTiming]}
                            {overdue && " · overdue"}
                          </span>
                        </span>
                        <Badge variant={status === "done" || status === "approved" ? "success" : status === "to_do" ? "default" : "warning"}>{PAPERWORK_STATUS_LABELS[status]}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {paperwork.length > 0 && <GenerateAllButton projectId={id} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
