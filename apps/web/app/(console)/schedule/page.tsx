import { addDays, ukDate, weekStart } from "@goinstall/core";
import Link from "next/link";
import { z } from "zod";
import { PageHeader } from "@/components/domain";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WeekGrid } from "@/components/week-grid";
import { asUser } from "@/lib/auth";
import { loadBookings, loadPeople } from "@/lib/schedule";
import { gridFor, weekColumns } from "@/lib/schedule-grid";
import { formatDate } from "@/lib/utils";
import { CalendarLink } from "./calendar-links";

export const metadata = { title: "Schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const monday = week && z.iso.date().safeParse(week).success ? weekStart(week) : weekStart(ukDate(new Date()));
  const { bookings, people, isAdmin } = await asUser(async (tx, s) => ({
    bookings: await loadBookings(tx, { from: monday, to: addDays(monday, 7) }),
    people: await loadPeople(tx),
    isAdmin: s.role === "admin",
  }));
  const { rows, items } = gridFor(monday, bookings, people.teams, { linkProjects: true });
  const clashes = items.filter((i) => i.clash).length;
  return (
    <>
      <PageHeader title="Schedule" description="Every team's surveys, installs and scaffolding across all projects." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex-wrap">
            <CardTitle>Week of {formatDate(monday, { day: "numeric", month: "long" })}</CardTitle>
            <nav aria-label="Week" className="flex gap-2">
              <Link href={`?week=${addDays(monday, -7)}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label="Previous week">
                ‹
              </Link>
              <Link href="/schedule" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Today
              </Link>
              <Link href={`?week=${addDays(monday, 7)}`} className={buttonVariants({ variant: "outline", size: "sm" })} aria-label="Next week">
                ›
              </Link>
            </nav>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {clashes > 0 && (
              <p role="alert" className="rounded-md bg-warning-tint px-3 py-2 text-sm font-semibold text-warning-text">
                {clashes} booking{clashes === 1 ? " is" : "s are"} double-booked this week.
              </p>
            )}
            <WeekGrid days={weekColumns(monday)} rows={rows} bookings={items} caption={`All bookings, week of ${monday}`} />
            <p className="text-xs text-muted-foreground">Drag to move a booking, or open the project to change it.</p>
          </CardContent>
        </Card>
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
