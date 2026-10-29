/**
 * Scheduling rules: week grids, clash detection and calendar feeds.
 * All-day bookings run from midnight UTC on the first day to midnight after
 * the last (end exclusive); dates are handled as YYYY-MM-DD strings.
 */

export const DAY_MS = 86_400_000;

/** YYYY-MM-DD in UK time. */
export function ukDate(d: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week containing the date. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

export function weekDays(monday: string, days = 5): string[] {
  return Array.from({ length: days }, (_, i) => addDays(monday, i));
}

/** Days a booking covers (inclusive list of dates). */
export function bookingDates(startsAt: Date | string, endsAt: Date | string): string[] {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  // All-day bookings are stored at UTC midnight: read their dates in UTC, or
  // British Summer Time would push the end onto the next day.
  const allDay = s.getTime() % DAY_MS === 0 && e.getTime() % DAY_MS === 0;
  const first = allDay ? s.toISOString().slice(0, 10) : ukDate(s);
  // End is exclusive: a booking ending at midnight doesn't cover that day.
  const last = allDay ? new Date(e.getTime() - DAY_MS).toISOString().slice(0, 10) : ukDate(new Date(e.getTime() - 1));
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 366; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * All-day span from a first date and a number of working days (weekends
 * skipped). The first date always counts: a job booked on a Saturday works
 * that Saturday.
 */
export function allDaySpan(firstDate: string, workingDays: number): { startsAt: string; endsAt: string } {
  let d = firstDate;
  let left = Math.max(1, Math.floor(workingDays));
  let last = d;
  while (left > 0) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (d === firstDate || (dow !== 0 && dow !== 6)) {
      left--;
      last = d;
    }
    d = addDays(d, 1);
  }
  return { startsAt: `${firstDate}T00:00:00.000Z`, endsAt: `${addDays(last, 1)}T00:00:00.000Z` };
}

export interface Bookable {
  id: string;
  startsAt: Date | string;
  endsAt: Date | string;
  /** e.g. "team:<id>", "user:<id>". */
  resources: string[];
}

/** For each booking, the other bookings that use one of its people or teams at the same time. */
export function findClashes(bookings: readonly Bookable[]): Map<string, { with: string; resource: string }[]> {
  const out = new Map<string, { with: string; resource: string }[]>();
  const t = (d: Date | string) => new Date(d).getTime();
  for (let i = 0; i < bookings.length; i++) {
    for (let j = i + 1; j < bookings.length; j++) {
      const a = bookings[i]!;
      const b = bookings[j]!;
      if (!(t(a.startsAt) < t(b.endsAt) && t(b.startsAt) < t(a.endsAt))) continue;
      const shared = a.resources.find((r) => b.resources.includes(r));
      if (!shared) continue;
      out.set(a.id, [...(out.get(a.id) ?? []), { with: b.id, resource: shared }]);
      out.set(b.id, [...(out.get(b.id) ?? []), { with: a.id, resource: shared }]);
    }
  }
  return out;
}

export interface CalendarEvent {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date | string;
  endsAt: Date | string;
  allDay: boolean;
  updatedAt: Date | string;
  cancelled?: boolean;
}

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (d: Date | string) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDate = (d: Date | string) => new Date(d).toISOString().slice(0, 10).replace(/-/g, "");

/** Lines over 75 octets are folded (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

/** An iCalendar feed that Google, Outlook and Apple calendars can subscribe to. */
export function icalFeed(name: string, events: readonly CalendarEvent[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GoInstall//Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(name)}`, "X-WR-TIMEZONE:Europe/London"];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${icsTime(e.updatedAt)}`,
      e.allDay ? `DTSTART;VALUE=DATE:${icsDate(e.startsAt)}` : `DTSTART:${icsTime(e.startsAt)}`,
      e.allDay ? `DTEND;VALUE=DATE:${icsDate(e.endsAt)}` : `DTEND:${icsTime(e.endsAt)}`,
      `SUMMARY:${icsText(e.title)}`,
      ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
      `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Scaffold goes up for roof work only: solar projects. EV and battery-only jobs don't get it. */
export function needsScaffold(products: readonly string[]): boolean {
  return products.includes("solar");
}

/** The bookings a project's Install tab offers, in order. */
export function installBookingTypes(products: readonly string[]): ("install" | "scaffold_up" | "scaffold_down")[] {
  return needsScaffold(products) ? ["install", "scaffold_up", "scaffold_down"] : ["install"];
}

export const BOOKING_TYPE_LABELS = { survey: "Survey", install: "Install", scaffold_up: "Scaffold up", scaffold_down: "Scaffold down", task: "Task" } as const;

// ---------------------------------------------------------------------------
// The Schedule calendar
// ---------------------------------------------------------------------------

export type CalendarView = "day" | "week" | "month";

/**
 * The dates a calendar view shows around `date` (YYYY-MM-DD): one day, a
 * Monday-to-Sunday week, or the month's full weeks (Monday start). `to` is
 * exclusive; `prev`/`next` are the dates the arrows go to.
 */
export function calendarRange(view: CalendarView, date: string): { from: string; to: string; days: string[]; prev: string; next: string } {
  if (view === "day") return { from: date, to: addDays(date, 1), days: [date], prev: addDays(date, -1), next: addDays(date, 1) };
  if (view === "week") {
    const from = weekStart(date);
    return { from, to: addDays(from, 7), days: Array.from({ length: 7 }, (_, i) => addDays(from, i)), prev: addDays(from, -7), next: addDays(from, 7) };
  }
  const first = `${date.slice(0, 7)}-01`;
  const from = weekStart(first);
  const nextMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)).toISOString().slice(0, 10);
  const lastWeek = weekStart(addDays(nextMonth, -1));
  const to = addDays(lastWeek, 7);
  const days: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  const prevMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 2, 1)).toISOString().slice(0, 10);
  return { from, to, days, prev: prevMonth, next: nextMonth };
}

const PRODUCT_WORDS: Record<string, string> = { solar: "Solar", battery: "battery", ev: "EV charger" };

/** What a booking is, in words: "Solar and battery installation", "EV charger survey", "Scaffold up". */
export function bookingTitle(type: keyof typeof BOOKING_TYPE_LABELS, products: readonly string[], title?: string | null): string {
  if (type === "task") return title || "Task";
  if (type === "scaffold_up" || type === "scaffold_down") return BOOKING_TYPE_LABELS[type];
  const words = ["solar", "battery", "ev"].filter((p) => products.includes(p)).map((p) => PRODUCT_WORDS[p]!);
  const what = words.length ? words.join(words.length > 2 ? ", " : " and ").replace(/, (?=[^,]*$)/, " and ") : "";
  const label = what ? `${what[0]!.toUpperCase()}${what.slice(1)} ${type === "install" ? "installation" : "survey"}` : type === "install" ? "Installation" : "Site survey";
  return label;
}
