import "server-only";
import { withUser, type AppRole, type Tx } from "@goinstall/db";
import { createClient } from "@supabase/supabase-js";
import { jwtVerify, SignJWT } from "jose";
import { db } from "./db";
import { devAuthEnabled } from "./env";
import { getSessionForUser, type Session } from "./auth";

/**
 * The installer app calls these routes with "Authorization: Bearer <token>":
 * a Supabase access token in staging and production, or a dev token from
 * /api/app/dev-login in local development. Queries then run as that user,
 * so RLS limits them to the jobs they're booked on.
 */

const APP_ROLES: AppRole[] = ["installer", "admin", "office"];

function devSecret() {
  return new TextEncoder().encode(process.env.DEV_AUTH_SECRET ?? "");
}

export async function createDevAppToken(userId: string) {
  if (!devAuthEnabled()) throw new Error("Dev sign-in is disabled");
  return new SignJWT({ app: true }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("7d").sign(devSecret());
}

async function userIdFromToken(token: string): Promise<string | null> {
  if (devAuthEnabled()) {
    try {
      const { payload } = await jwtVerify(token, devSecret());
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const { data } = await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(token);
  return data.user?.id ?? null;
}

// The app's web build runs on its own origin in development.
export function cors(request: Request, res: Response) {
  const origin = request.headers.get("origin");
  const allowed = (process.env.APP_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (origin && (allowed.includes(origin) || (devAuthEnabled() && /^http:\/\/localhost:\d+$/.test(origin)))) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.headers.set("Vary", "Origin");
  }
  return res;
}

export const preflight = (request: Request) => cors(request, new Response(null, { status: 204 }));

export async function withAppUser(request: Request, fn: (tx: Tx, session: Session) => Promise<Response>, roles: AppRole[] = APP_ROLES): Promise<Response> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const userId = token ? await userIdFromToken(token) : null;
  const session = userId ? await getSessionForUser(userId) : null;
  if (!session) return cors(request, Response.json({ error: "Sign in again" }, { status: 401 }));
  if (!roles.includes(session.role)) return cors(request, Response.json({ error: "Not allowed" }, { status: 403 }));
  const res = await withUser(db(), session.userId, (tx) => fn(tx, session));
  return cors(request, res);
}
