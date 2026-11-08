import { describe, expect, it, vi } from "vitest";
import { createGoogleCalendar, createGoogleCalendarAuth } from "./calendar";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const event = { summary: "Solar installation · Grace Okafor", location: "27 Henleaze Gardens, Bristol", description: null, start: { date: "2026-11-09" }, end: { date: "2026-11-11" }, bookingId: "b-1" };

describe("Google Calendar adapter", () => {
  it("asks only for event access, offline, and reads the account's email from the id token", async () => {
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "dan@brightside.test" })).toString("base64url")}.y`;
    const fetch = vi.fn(async () => json({ access_token: "a", refresh_token: "r", expires_in: 3600, id_token: idToken }));
    const auth = createGoogleCalendarAuth({ clientId: "cid", clientSecret: "sec", redirectUri: "https://app/cb", fetch });
    const url = new URL(auth.authorizeUrl("st"));
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.events");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(await auth.exchangeCode("c")).toMatchObject({ accessToken: "a", refreshToken: "r", email: "dan@brightside.test" });
  });

  it("creates an all-day event tagged with the booking, and recreates one deleted in Google", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: "Not Found" } }, 404))
      .mockResolvedValueOnce(json({ id: "evt-2" }));
    const cal = createGoogleCalendar({ accessToken: "t", fetch });
    expect(await cal.upsertEvent(event, "evt-1")).toEqual({ eventId: "evt-2" });
    const [url, init] = fetch.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ summary: event.summary, start: { date: "2026-11-09" }, end: { date: "2026-11-11" }, extendedProperties: { private: { goinstallBookingId: "b-1" } } });
  });

  it("sends timed events in UK time and ignores deleting one that's already gone", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ id: "evt-3" })).mockResolvedValueOnce(json({}, 410));
    const cal = createGoogleCalendar({ accessToken: "t", fetch });
    await cal.upsertEvent({ ...event, start: { dateTime: "2026-11-09T09:00:00Z" }, end: { dateTime: "2026-11-09T11:00:00Z" } }, null);
    expect(JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body)).start).toEqual({ dateTime: "2026-11-09T09:00:00Z", timeZone: "Europe/London" });
    await expect(cal.deleteEvent("evt-3")).resolves.toBeUndefined();
  });
});
