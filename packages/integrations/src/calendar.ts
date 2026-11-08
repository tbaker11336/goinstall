/**
 * Google Calendar: each person connects their own calendar (OAuth 2.0) and
 * their bookings are written to it as events. One-way: GoInstall is the
 * source; events are updated when bookings move and deleted when cancelled.
 */

export interface CalendarTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface CalendarEvent {
  summary: string;
  location: string | null;
  description: string | null;
  /** All day: dates (end exclusive, as Google wants). Timed: ISO date-times. */
  start: { date: string } | { dateTime: string };
  end: { date: string } | { dateTime: string };
  /** Our booking id, kept on the event so it can be found again. */
  bookingId: string;
}

export interface CalendarClient {
  readonly name: string;
  /** Create (no id) or replace an event; returns its id. A deleted event is recreated. */
  upsertEvent(event: CalendarEvent, existingId: string | null): Promise<{ eventId: string }>;
  deleteEvent(eventId: string): Promise<void>;
}

export interface CalendarAuth {
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<CalendarTokens & { email: string | null }>;
  refresh(refreshToken: string): Promise<CalendarTokens>;
  revoke(token: string): Promise<void>;
}

/** Only the events this app writes; no reading of anyone's calendar. */
export const GOOGLE_CALENDAR_SCOPES = "openid email https://www.googleapis.com/auth/calendar.events";

export class CalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(f: typeof fetch, url: string, init: RequestInit) {
  const res = await f(url, init);
  const text = await res.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new CalendarError((body as { error?: { message?: string }; error_description?: string } | null)?.error?.message ?? (body as { error_description?: string } | null)?.error_description ?? `Google error ${res.status}`, res.status);
  return body;
}

export function createGoogleCalendarAuth(o: { clientId: string; clientSecret: string; redirectUri: string; fetch?: typeof fetch }): CalendarAuth {
  const f = o.fetch ?? fetch;
  const token = async (body: Record<string, string>) =>
    (await call(f, "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, ...body }).toString(),
    })) as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
  const expires = (s: number) => new Date(Date.now() + (s - 60) * 1000).toISOString();
  return {
    authorizeUrl(state) {
      const q = new URLSearchParams({ client_id: o.clientId, redirect_uri: o.redirectUri, response_type: "code", scope: GOOGLE_CALENDAR_SCOPES, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    async exchangeCode(code) {
      const r = await token({ grant_type: "authorization_code", code, redirect_uri: o.redirectUri });
      if (!r.refresh_token) throw new CalendarError("Google didn't give offline access; please try again.", 400);
      // The id token's payload names the Google account (no need to verify: it came straight from Google over TLS).
      let email: string | null = null;
      try {
        email = (JSON.parse(Buffer.from(r.id_token!.split(".")[1]!, "base64url").toString()) as { email?: string }).email ?? null;
      } catch {
        email = null;
      }
      return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: expires(r.expires_in), email };
    },
    async refresh(refreshToken) {
      const r = await token({ grant_type: "refresh_token", refresh_token: refreshToken });
      return { accessToken: r.access_token, refreshToken: r.refresh_token ?? refreshToken, expiresAt: expires(r.expires_in) };
    },
    async revoke(t) {
      await f(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => undefined);
    },
  };
}

export function createGoogleCalendar(o: { accessToken: string; calendarId?: string; fetch?: typeof fetch }): CalendarClient {
  const f = o.fetch ?? fetch;
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(o.calendarId ?? "primary")}/events`;
  const headers = { Authorization: `Bearer ${o.accessToken}`, "Content-Type": "application/json" };
  const body = (e: CalendarEvent) =>
    JSON.stringify({
      summary: e.summary,
      location: e.location ?? undefined,
      description: e.description ?? undefined,
      start: "dateTime" in e.start ? { dateTime: e.start.dateTime, timeZone: "Europe/London" } : e.start,
      end: "dateTime" in e.end ? { dateTime: e.end.dateTime, timeZone: "Europe/London" } : e.end,
      extendedProperties: { private: { goinstallBookingId: e.bookingId } },
      status: "confirmed",
    });
  return {
    name: "google",
    async upsertEvent(e, existingId) {
      if (existingId) {
        try {
          const r = (await call(f, `${base}/${encodeURIComponent(existingId)}`, { method: "PUT", headers, body: body(e) })) as { id: string };
          return { eventId: r.id };
        } catch (err) {
          // Deleted in Google: make it again.
          if (!(err instanceof CalendarError) || (err.status !== 404 && err.status !== 410)) throw err;
        }
      }
      const r = (await call(f, base, { method: "POST", headers, body: body(e) })) as { id: string };
      return { eventId: r.id };
    },
    async deleteEvent(eventId) {
      try {
        await call(f, `${base}/${encodeURIComponent(eventId)}`, { method: "DELETE", headers });
      } catch (err) {
        if (!(err instanceof CalendarError) || (err.status !== 404 && err.status !== 410)) throw err;
      }
    },
  };
}

/** Stand-in calendar for development and tests: events kept by the caller (e.g. in a file). */
export function createFakeCalendar(o: { load: () => Record<string, CalendarEvent & { owner: string }>; save: (s: Record<string, CalendarEvent & { owner: string }>) => void; owner: string }): CalendarClient {
  let n = 0;
  return {
    name: "fake-calendar",
    async upsertEvent(e, existingId) {
      const s = o.load();
      const eventId = existingId && s[existingId] ? existingId : `evt-${Date.now().toString(36)}-${++n}`;
      s[eventId] = { ...e, owner: o.owner };
      o.save(s);
      return { eventId };
    },
    async deleteEvent(eventId) {
      const s = o.load();
      delete s[eventId];
      o.save(s);
    },
  };
}
