import { bookingDates, bookingTitle, calendarRange, ukDate, type CalendarView } from "@goinstall/core";
import { z } from "zod";
import { PageHeader } from "@/components/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { asUser } from "@/lib/auth";
import { loadBookings, loadPeople, type ScheduleBooking } from "@/lib/schedule";
import { CalendarLink } from "./calendar-links";
import { ScheduleCalendar, type CalendarEvent } from "./schedule-calendar";

export const metadata = { title: "Schedule" };

const VIEWS = ["day", "week", "month"] as const;
const londonTime = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** One calendar for every booking: day, week or month, optionally for one team. */
export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; team?: string; week?: string }> }) {
  const sp = await searchParams;
  const view: CalendarView = VIEWS.includes(sp.view as CalendarView) ? (sp.view as CalendarView) : "week";
  const raw = sp.date ?? sp.week; // ?week= links from before the calendar changed
  const date = raw && z.iso.date().safeParse(raw).success ? raw : ukDate(new Date());
  const range = calendarRange(view, date);
  const team = sp.team && z.uuid().safeParse(sp.team).success ? sp.team : null;

  const { bookings, people, isAdmin } = await asUser(async (tx, s) => ({
    bookings: await loadBookings(tx, { from: range.from, to: range.to }),
    people: await loadPeople(tx),
    isAdmin: s.role === "admin",
  }));

  const members = team ? new Set(people.users.filter((u) => u.team_id === team).map((u) => u.id)) : null;
  const onTeam = (b: ScheduleBooking) => !team || b.assignments.some((a) => a.teamId === team || (a.userId && members!.has(a.userId)));
  const events: CalendarEvent[] = bookings.filter(onTeam).map((b) => ({
    id: b.id,
    type: b.type,
    title: bookingTitle(b.type, b.products, b.title),
    customer: b.contactName,
    address: b.address,
    projectId: b.projectId,
    dates: bookingDates(b.startsAt, b.endsAt),
    allDay: b.allDay,
    time: b.allDay ? null : `${londonTime(b.startsAt)}–${londonTime(b.endsAt)}`,
    startTime: b.allDay ? null : londonTime(b.startsAt),
    people: b.assignments.map((a) => ({ role: a.role, name: a.name })),
    teamId: b.assignments.find((a) => a.role === "team")?.teamId ?? null,
    status: b.status,
    notifiedAt: b.customerNotifiedAt?.toISOString() ?? null,
    confirmedAt: b.customerConfirmedAt?.toISOString() ?? null,
    clash: b.clashes.length > 0,
    notes: b.notes,
    responses: b.responses,
  }));

  return (
    <>
      <PageHeader title="Schedule" description="Every survey, installation and scaffold booking. Click a booking to see it, move it or tell the customer." />
      <div className="flex flex-col gap-6">
        <ScheduleCalendar
          view={view}
          date={date}
          today={ukDate(new Date())}
          range={range}
          events={events}
          teams={people.teams.map((t) => ({ id: t.id, name: t.name }))}
          team={team}
        />
        {isAdmin && people.teams.length > 0 && (
          <Card>
            <CardHeader className="flex-col items-start">
              <CardTitle>Team calendars</CardTitle>
              <p className="text-sm text-ink-3">Each team gets a private link its members can subscribe to in Google, Outlook or Apple Calendar. Bookings appear within a few hours of changing.</p>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {people.teams.map((t) => (
                  <CalendarLink key={t.id} teamId={t.id} teamName={t.name} hasLink={Boolean(t.calendar_nonce)} />
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
