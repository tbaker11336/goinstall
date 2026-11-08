import "server-only";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addDays, bookingDates, bookingTitle } from "@goinstall/core";
import { sql, withService, type Tx } from "@goinstall/db";
import { createFakeCalendar, createGoogleCalendar, createGoogleCalendarAuth, type CalendarAuth, type CalendarClient, type CalendarEvent, type CalendarTokens } from "@goinstall/integrations";
import { after } from "next/server";
import { db } from "./db";
import { env } from "./env";
import { openTokens, sealTokens } from "./token-crypto";

/**
 * Google Calendar, per person: everyone booked on a job (directly or through
 * their team) who has connected their calendar gets the booking as an event.
 * Moves update it; cancelling, or coming off the booking, removes it.
 */

export const calendarFake = () => process.env.GOOGLE_CALENDAR_FAKE === "true" && !process.env.VERCEL;
export const calendarConfigured = () => calendarFake() || Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
export const calendarRedirectUri = () => `${env.siteUrl.replace(/\/$/, "")}/api/integrations/google-calendar/callback`;
const PROVIDER = "google_calendar";

const fakeFile = () => process.env.GOOGLE_CALENDAR_FAKE_FILE ?? path.join(process.cwd(), ".data", "calendar-fake.json");
const loadFake = () => {
  try {
    return JSON.parse(readFileSync(fakeFile(), "utf8")) as Record<string, CalendarEvent & { owner: string }>;
  } catch {
    return {};
  }
};
const saveFake = (s: Record<string, CalendarEvent & { owner: string }>) => {
  mkdirSync(path.dirname(fakeFile()), { recursive: true });
  writeFileSync(fakeFile(), JSON.stringify(s, null, 1));
};

export function calendarAuth(): CalendarAuth {
  if (calendarFake()) {
    const t = (): CalendarTokens => ({ accessToken: "fake-access", refreshToken: "fake-refresh", expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    return {
      authorizeUrl: (state) => `${env.siteUrl.replace(/\/$/, "")}/api/dev/fake-google-calendar?state=${encodeURIComponent(state)}`,
      exchangeCode: async () => ({ ...t(), email: "you@example.com" }),
      refresh: async () => t(),
      revoke: async () => undefined,
    };
  }
  return createGoogleCalendarAuth({ clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!, clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!, redirectUri: calendarRedirectUri() });
}

export async function storeCalendarTokens(tx: Tx, integrationId: string, companyId: string, tokens: CalendarTokens) {
  await sql`
    insert into private.integration_secrets (integration_id, company_id, ciphertext, updated_at)
    values (${integrationId}, ${companyId}, ${sealTokens(tokens)}, now())
    on conflict (integration_id) do update set ciphertext = excluded.ciphertext, updated_at = now()
  `.execute(tx);
}

/** Connected calendars for these people (service role), with fresh tokens. */
async function calendarsFor(tx: Tx, companyId: string, userIds: string[]): Promise<Map<string, CalendarClient>> {
  const out = new Map<string, CalendarClient>();
  if (!userIds.length) return out;
  const rows = (
    await sql<{ id: string; user_id: string; ciphertext: string }>`
      select i.id, i.user_id, s.ciphertext
      from public.integrations i join private.integration_secrets s on s.integration_id = i.id
      where i.company_id = ${companyId} and i.provider = ${PROVIDER} and i.status = 'connected' and i.user_id = any(${userIds}::uuid[])
    `.execute(tx)
  ).rows;
  for (const r of rows) {
    try {
      let tokens = openTokens<CalendarTokens>(r.ciphertext);
      if (new Date(tokens.expiresAt).getTime() < Date.now()) {
        tokens = await calendarAuth().refresh(tokens.refreshToken);
        await storeCalendarTokens(tx, r.id, companyId, tokens);
      }
      out.set(r.user_id, calendarFake() ? createFakeCalendar({ load: loadFake, save: saveFake, owner: r.user_id }) : createGoogleCalendar({ accessToken: tokens.accessToken }));
    } catch (e) {
      console.error("calendar tokens", r.user_id, e);
      // Access withdrawn in Google: mark it so the person sees they need to reconnect.
      await tx.updateTable("integrations").set({ status: "error" }).where("id", "=", r.id).execute();
    }
  }
  return out;
}

const london = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);

/** Bring one booking's events in everyone's calendar in line with the booking. */
export async function syncBookingToCalendars(companyId: string, bookingId: string): Promise<void> {
  await withService(db(), async (tx) => {
    const b = await tx
      .selectFrom("bookings as b")
      .leftJoin("projects as p", (j) => j.onRef("p.id", "=", "b.project_id").onRef("p.company_id", "=", "b.company_id"))
      .leftJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
      .select(["b.id", "b.type", "b.title", "b.status", "b.starts_at", "b.ends_at", "b.all_day", "b.notes", "p.products", "p.site_address_line1", "p.site_town", "p.site_postcode", "c.name as customer"])
      .where("b.id", "=", bookingId)
      .where("b.company_id", "=", companyId)
      .executeTakeFirst();
    const existing = await tx.selectFrom("booking_calendar_events").select(["id", "user_id", "event_id"]).where("booking_id", "=", bookingId).where("company_id", "=", companyId).execute();
    // Who's on it: people booked directly, and the members of booked teams.
    let people: string[] = [];
    if (b && b.status !== "cancelled") {
      const a = await tx.selectFrom("booking_assignments").select(["user_id", "team_id"]).where("booking_id", "=", bookingId).where("company_id", "=", companyId).execute();
      const teams = a.flatMap((x) => (x.team_id ? [x.team_id] : []));
      const members = teams.length ? (await tx.selectFrom("users").select("id").where("company_id", "=", companyId).where("team_id", "in", teams).where("is_active", "=", true).execute()).map((u) => u.id) : [];
      people = [...new Set([...a.flatMap((x) => (x.user_id ? [x.user_id] : [])), ...members])];
    }
    const cals = await calendarsFor(tx, companyId, [...new Set([...people, ...existing.map((e) => e.user_id)])]);
    if (b && b.status !== "cancelled") {
      const days = bookingDates(b.starts_at, b.ends_at);
      const event: CalendarEvent = {
        summary: [bookingTitle(b.type, b.products ?? [], b.title), b.customer].filter(Boolean).join(" · "),
        location: [b.site_address_line1, b.site_town, b.site_postcode].filter(Boolean).join(", ") || null,
        description: [b.notes, "Booked in GoInstall."].filter(Boolean).join("\n\n"),
        start: b.all_day ? { date: days[0] ?? london(b.starts_at) } : { dateTime: b.starts_at.toISOString() },
        end: b.all_day ? { date: addDays(days.at(-1) ?? london(b.starts_at), 1) } : { dateTime: b.ends_at.toISOString() },
        bookingId,
      };
      for (const userId of people) {
        const cal = cals.get(userId);
        if (!cal) continue;
        const had = existing.find((e) => e.user_id === userId);
        try {
          const { eventId } = await cal.upsertEvent(event, had?.event_id ?? null);
          if (had) await tx.updateTable("booking_calendar_events").set({ event_id: eventId }).where("id", "=", had.id).execute();
          else await tx.insertInto("booking_calendar_events").values({ company_id: companyId, booking_id: bookingId, user_id: userId, event_id: eventId, created_by: null }).execute();
        } catch (e) {
          // One person's calendar failing doesn't stop the others.
          console.error("calendar event", userId, e);
        }
      }
    }
    // Off the booking (or it's cancelled): remove their event.
    for (const e of existing.filter((x) => !people.includes(x.user_id))) {
      await cals
        .get(e.user_id)
        ?.deleteEvent(e.event_id)
        .catch(() => undefined);
      await tx.deleteFrom("booking_calendar_events").where("id", "=", e.id).execute();
    }
  });
}

/** After the response: keep calendars in step with a booking that just changed. */
export function syncCalendarsLater(companyId: string, bookingIds: string | string[]) {
  const ids = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
  after(async () => {
    for (const id of ids) await syncBookingToCalendars(companyId, id).catch((e) => console.error("calendar sync", id, e));
  });
}

/** Before bookings are deleted with their project: take their events out of people's calendars. */
export async function removeCalendarEvents(companyId: string, bookingIds: string[]) {
  if (!bookingIds.length) return;
  await withService(db(), async (tx) => {
    const rows = await tx.selectFrom("booking_calendar_events").select(["id", "user_id", "event_id"]).where("company_id", "=", companyId).where("booking_id", "in", bookingIds).execute();
    const cals = await calendarsFor(tx, companyId, [...new Set(rows.map((r) => r.user_id))]);
    for (const r of rows) await cals.get(r.user_id)?.deleteEvent(r.event_id).catch(() => undefined);
  });
}

/** A newly connected calendar gets the person's upcoming bookings (next 90 days). */
export async function backfillCalendar(companyId: string, userId: string) {
  const ids = await withService(db(), async (tx) => {
    const me = await tx.selectFrom("users").select("team_id").where("id", "=", userId).where("company_id", "=", companyId).executeTakeFirst();
    return (
      await tx
        .selectFrom("bookings as b")
        .innerJoin("booking_assignments as a", (j) => j.onRef("a.booking_id", "=", "b.id").onRef("a.company_id", "=", "b.company_id"))
        .select("b.id")
        .distinct()
        .where("b.company_id", "=", companyId)
        .where("b.status", "!=", "cancelled")
        .where("b.ends_at", ">", new Date())
        .where("b.starts_at", "<", new Date(Date.now() + 90 * 86_400_000))
        .where((eb) => eb.or([eb("a.user_id", "=", userId), ...(me?.team_id ? [eb("a.team_id", "=", me.team_id)] : [])]))
        .execute()
    ).map((r) => r.id);
  });
  for (const id of ids) await syncBookingToCalendars(companyId, id).catch((e) => console.error("calendar sync", id, e));
  return ids.length;
}
