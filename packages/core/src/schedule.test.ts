import { describe, expect, it } from "vitest";
import { allDaySpan, bookingDates, bookingTitle, calendarRange, findClashes, icalFeed, installBookingTypes, needsScaffold, weekStart } from "./schedule";

describe("schedule", () => {
  it("finds the Monday and spans working days", () => {
    expect(weekStart("2026-11-05")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    // Tue 3 Nov for 2 days → Tue, Wed.
    const s = allDaySpan("2026-11-03", 2);
    expect(s).toEqual({ startsAt: "2026-11-03T00:00:00.000Z", endsAt: "2026-11-05T00:00:00.000Z" });
    expect(bookingDates(s.startsAt, s.endsAt)).toEqual(["2026-11-03", "2026-11-04"]);
    // A one-day booking in British Summer Time is still one day.
    expect(bookingDates("2026-10-20T00:00:00.000Z", "2026-10-21T00:00:00.000Z")).toEqual(["2026-10-20"]);
    // Timed bookings use UK time: 23:30 UTC on 20 Oct is 00:30 on the 21st in BST.
    expect(bookingDates("2026-10-20T23:30:00Z", "2026-10-21T00:30:00Z")).toEqual(["2026-10-21"]);
    // Fri for 2 working days skips the weekend.
    expect(bookingDates(...(Object.values(allDaySpan("2026-11-06", 2)) as [string, string]))).toEqual(["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
    // Booked on a Sunday: that Sunday counts, then Monday.
    expect(bookingDates(...(Object.values(allDaySpan("2026-10-25", 1)) as [string, string]))).toEqual(["2026-10-25"]);
    expect(bookingDates(...(Object.values(allDaySpan("2026-10-25", 2)) as [string, string]))).toEqual(["2026-10-25", "2026-10-26"]);
  });

  it("works out the dates each calendar view shows", () => {
    expect(calendarRange("day", "2026-10-29")).toMatchObject({ from: "2026-10-29", to: "2026-10-30", days: ["2026-10-29"], prev: "2026-10-28", next: "2026-10-30" });
    const w = calendarRange("week", "2026-10-29"); // a Thursday
    expect(w).toMatchObject({ from: "2026-10-26", to: "2026-11-02", prev: "2026-10-19", next: "2026-11-02" });
    expect(w.days).toHaveLength(7);
    // October 2026 starts on a Thursday and ends on a Saturday: Mon 28 Sep to Sun 1 Nov.
    const m = calendarRange("month", "2026-10-15");
    expect(m).toMatchObject({ from: "2026-09-28", to: "2026-11-02", prev: "2026-09-01", next: "2026-11-01" });
    expect(m.days).toHaveLength(35);
    expect(calendarRange("month", "2026-01-31").prev).toBe("2025-12-01");
  });

  it("names bookings by what they are", () => {
    expect(bookingTitle("install", ["ev"])).toBe("EV charger installation");
    expect(bookingTitle("install", ["solar", "battery"])).toBe("Solar and battery installation");
    expect(bookingTitle("install", ["solar", "battery", "ev"])).toBe("Solar, battery and EV charger installation");
    expect(bookingTitle("survey", ["ev"])).toBe("EV charger survey");
    expect(bookingTitle("scaffold_up", ["solar"])).toBe("Scaffold up");
    expect(bookingTitle("task", [], "Collect from depot")).toBe("Collect from depot");
    expect(bookingTitle("install", [])).toBe("Installation");
  });

  it("offers scaffold only on solar projects", () => {
    expect(installBookingTypes(["solar", "battery"])).toEqual(["install", "scaffold_up", "scaffold_down"]);
    expect(installBookingTypes(["ev"])).toEqual(["install"]);
    expect(installBookingTypes(["battery"])).toEqual(["install"]);
    expect(needsScaffold(["ev", "solar"])).toBe(true);
  });

  it("flags double-booked teams and people only", () => {
    const c = findClashes([
      { id: "a", startsAt: "2026-11-03T00:00:00Z", endsAt: "2026-11-05T00:00:00Z", resources: ["team:A"] },
      { id: "b", startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-05T00:00:00Z", resources: ["team:A", "user:sam"] },
      { id: "c", startsAt: "2026-11-05T00:00:00Z", endsAt: "2026-11-06T00:00:00Z", resources: ["team:A"] },
      { id: "d", startsAt: "2026-11-03T00:00:00Z", endsAt: "2026-11-04T00:00:00Z", resources: ["team:B"] },
    ]);
    expect(c.get("a")).toEqual([{ with: "b", resource: "team:A" }]);
    expect(c.has("c")).toBe(false);
    expect(c.has("d")).toBe(false);
  });

  it("writes a valid all-day iCal event", () => {
    const ics = icalFeed("Team A", [{ uid: "x@goinstall", title: "Install, 14 Elm Close; solar", startsAt: "2026-11-03T00:00:00Z", endsAt: "2026-11-05T00:00:00Z", allDay: true, updatedAt: "2026-10-20T10:00:00Z" }]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261103\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20261105\r\n");
    expect(ics).toContain("SUMMARY:Install\\, 14 Elm Close\; solar\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
