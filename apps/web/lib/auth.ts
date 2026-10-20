import "server-only";
import { withService, withUser, type AppRole, type Tx } from "@goinstall/db";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { devAuthEnabled } from "./env";
import { supabaseServer } from "./supabase/server";

export const DEV_SESSION_COOKIE = "gi_dev_session";

function devSecret() {
  const secret = process.env.DEV_AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("DEV_AUTH_SECRET must be at least 16 characters");
  return new TextEncoder().encode(secret);
}

export async function createDevSession(userId: string) {
  if (!devAuthEnabled()) throw new Error("Dev sign-in is disabled");
  const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("12h").sign(devSecret());
  (await cookies()).set(DEV_SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
}

/** Id of the signed-in auth user, verified with Supabase Auth. */
export const getAuthUser = cache(async (): Promise<{ id: string; email: string | null } | null> => {
  if (devAuthEnabled()) {
    const token = (await cookies()).get(DEV_SESSION_COOKIE)?.value;
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, devSecret());
      return payload.sub ? { id: payload.sub, email: null } : null;
    } catch {
      return null;
    }
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
});

export interface Session {
  userId: string;
  fullName: string;
  email: string;
  role: AppRole;
  companyId: string;
  companyName: string;
}

/** The signed-in user's profile, or null if not signed in or not set up. */
export const getSession = cache(async (): Promise<Session | null> => {
  const authUser = await getAuthUser();
  if (!authUser) return null;
  return getSessionForUser(authUser.id);
});

/** Profile for a verified auth user id (also used for the installer app's bearer tokens). */
export async function getSessionForUser(userId: string): Promise<Session | null> {
  const row = await withService(db(), (tx) =>
    tx
      .selectFrom("users")
      .innerJoin("companies", "companies.id", "users.company_id")
      .select(["users.id", "users.full_name", "users.email", "users.role", "users.company_id", "companies.name as company_name"])
      .where("users.id", "=", userId)
      .where("users.is_active", "=", true)
      .executeTakeFirst(),
  );
  if (!row) return null;
  return {
    userId: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    companyId: row.company_id,
    companyName: row.company_name,
  };
}

const CONSOLE_ROLES: AppRole[] = ["admin", "office"];

/**
 * For console pages and actions: redirects to login, onboarding or the
 * no-access page as needed. Optionally restrict to specific roles.
 */
export async function requireSession(roles: AppRole[] = CONSOLE_ROLES): Promise<Session> {
  const authUser = await getAuthUser();
  if (!authUser) redirect("/login");
  const session = await getSession();
  if (!session) redirect("/onboarding");
  if (!roles.includes(session.role)) redirect(CONSOLE_ROLES.includes(session.role) ? "/dashboard" : "/no-access");
  return session;
}

export const requireAdmin = () => requireSession(["admin"]);

/**
 * Run queries as the signed-in user, so RLS applies. Use this for every
 * read and write made on a user's behalf.
 */
export async function asUser<T>(fn: (tx: Tx, session: Session) => Promise<T>, roles?: AppRole[]): Promise<T> {
  const session = await requireSession(roles);
  return withUser(db(), session.userId, (tx) => fn(tx, session));
}

export async function signOut() {
  if (devAuthEnabled()) {
    (await cookies()).delete(DEV_SESSION_COOKIE);
    return;
  }
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}
