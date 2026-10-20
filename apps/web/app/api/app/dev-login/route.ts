import { withService } from "@goinstall/db";
import { z } from "zod";
import { cors, createDevAppToken, preflight } from "@/lib/app-auth";
import { db } from "@/lib/db";
import { devAuthEnabled } from "@/lib/env";

export const OPTIONS = preflight;

/** Local development only: list seeded field staff and sign in as one (mirrors the console's dev sign-in). */
export async function GET(request: Request) {
  if (!devAuthEnabled()) return new Response("Not found", { status: 404 });
  const users = await withService(db(), (tx) => tx.selectFrom("users").select(["id", "full_name", "role"]).where("role", "in", ["installer", "admin", "office"]).where("is_active", "=", true).orderBy("full_name").execute());
  return cors(request, Response.json({ users }));
}

export async function POST(request: Request) {
  if (!devAuthEnabled()) return new Response("Not found", { status: 404 });
  const body = z.object({ userId: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return cors(request, Response.json({ error: "Bad request" }, { status: 400 }));
  return cors(request, Response.json({ token: await createDevAppToken(body.data.userId) }));
}
