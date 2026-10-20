import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { findClashes, type Bookable } from "@goinstall/core";
import type { Tx } from "@goinstall/db";
import { env } from "./env";

export interface ScheduleBooking {
  id: string;
  projectId: string | null;
  type: "survey" | "install" | "scaffold_up" | "scaffold_down" | "task";
  status: string;
  title: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  notes: string | null;
  customerConfirmedAt: Date | null;
  customerNotifiedAt: Date | null;
  address: string | null;
  products: string[];
  assignments: { role: string; teamId: string | null; userId: string | null; name: string }[];
  clashes: { with: string; resource: string }[];
}

/** Bookings overlapping [from, to), with assignments and clash warnings. */
export async function loadBookings(tx: Tx, range: { from: string; to: string; projectId?: string }): Promise<ScheduleBooking[]> {
  let q = tx
    .selectFrom("bookings as b")
    .leftJoin("projects as p", "p.id", "b.project_id")
    .select(["b.id", "b.project_id", "b.type", "b.status", "b.title", "b.starts_at", "b.ends_at", "b.all_day", "b.notes", "b.customer_confirmed_at", "b.customer_notified_at", "p.site_address_line1", "p.site_town", "p.products"])
    .where("b.status", "!=", "cancelled")
    .orderBy("b.starts_at");
  q = range.projectId ? q.where("b.project_id", "=", range.projectId) : q.where("b.starts_at", "<", new Date(`${range.to}T00:00:00Z`)).where("b.ends_at", ">", new Date(`${range.from}T00:00:00Z`));
  const rows = await q.execute();
  const ids = rows.map((r) => r.id);
  const assignments = ids.length
    ? await tx
        .selectFrom("booking_assignments as a")
        .leftJoin("teams as t", "t.id", "a.team_id")
        .leftJoin("users as u", "u.id", "a.user_id")
        .select(["a.booking_id", "a.role", "a.team_id", "a.user_id", "t.name as team_name", "u.full_name"])
        .where("a.booking_id", "in", ids)
        .execute()
    : [];
  const bookable: Bookable[] = rows.map((r) => ({
    id: r.id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    resources: assignments.filter((a) => a.booking_id === r.id).map((a) => (a.team_id ? `team:${a.team_id}` : `user:${a.user_id}`)),
  }));
  // Clashes are checked against everything overlapping these bookings, not just this list.
  const extra =
    range.projectId && rows.length
      ? await loadBookings(tx, { from: rows[0]!.starts_at.toISOString().slice(0, 10), to: new Date(Math.max(...rows.map((r) => r.ends_at.getTime())) + 86_400_000).toISOString().slice(0, 10) })
      : [];
  const clashes = findClashes([...bookable, ...extra.filter((e) => !ids.includes(e.id)).map((e) => ({ id: e.id, startsAt: e.startsAt, endsAt: e.endsAt, resources: e.assignments.map((a) => (a.teamId ? `team:${a.teamId}` : `user:${a.userId}`)) }))]);
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    type: r.type,
    status: r.status,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    allDay: r.all_day,
    notes: r.notes,
    customerConfirmedAt: r.customer_confirmed_at,
    customerNotifiedAt: r.customer_notified_at,
    address: [r.site_address_line1, r.site_town].filter(Boolean).join(", ") || null,
    products: r.products ?? [],
    assignments: assignments
      .filter((a) => a.booking_id === r.id)
      .map((a) => ({ role: a.role, teamId: a.team_id, userId: a.user_id, name: a.team_name ?? a.full_name ?? "" })),
    clashes: clashes.get(r.id) ?? [],
  }));
}

export async function loadPeople(tx: Tx) {
  const [teams, users] = await Promise.all([
    tx.selectFrom("teams").select(["id", "name", "colour", "calendar_nonce"]).orderBy("name").execute(),
    tx.selectFrom("users").select(["id", "full_name", "role", "team_id"]).where("is_active", "=", true).orderBy("full_name").execute(),
  ]);
  return {
    teams: teams.map((t) => ({ ...t, members: users.filter((u) => u.team_id === t.id).map((u) => u.full_name.split(" ")[0] ?? u.full_name) })),
    users,
  };
}

// --- Team calendar feed links -------------------------------------------------

function feedSecret() {
  const s = process.env.LINK_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.DEV_AUTH_SECRET;
  if (!s) throw new Error("Set LINK_SIGNING_SECRET to create calendar links");
  return s;
}

export const newCalendarNonce = () => randomBytes(12).toString("base64url");

function feedSig(teamId: string, nonce: string) {
  return createHmac("sha256", feedSecret()).update(`calendar:${teamId}:${nonce}`).digest("base64url");
}

export function calendarFeedUrl(teamId: string, nonce: string) {
  return `${env.siteUrl.replace(/\/$/, "")}/api/calendar/${teamId}.${feedSig(teamId, nonce)}.ics`;
}

/** Team id from a feed token if its signature matches the team's current nonce. */
export function verifyCalendarToken(token: string, nonceFor: (teamId: string) => string | null): boolean {
  const [teamId, sig] = token.split(".");
  if (!teamId || !sig) return false;
  const nonce = nonceFor(teamId);
  if (!nonce) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(feedSig(teamId, nonce));
  return a.length === b.length && timingSafeEqual(a, b);
}
