import { describe, expect, it } from "vitest";
import { allDaySpan, bookingDates, findClashes, icalFeed, weekStart } from "./schedule";

describe("schedule", () => {
  it("finds the Monday and spans working days", () => {
    expect(weekStart("2026-11-05")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    // Tue 3 Nov for 2 days → Tue, Wed.
    const s = allDaySpan("2026-11-03", 2);
    expect(s).toEqual({ startsAt: "2026-11-03T00:00:00.000Z", endsAt: "2026-11-05T00:00:00.000Z" });
    expect(bookingDates(s.startsAt, s.endsAt)).toEqual(["2026-11-03", "2026-11-04"]);
    // Fri for 2 working days skips the weekend.
    expect(bookingDates(...(Object.values(allDaySpan("2026-11-06", 2)) as [string, string]))).toEqual(["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
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
