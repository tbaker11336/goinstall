import { sql } from "@goinstall/db";
import { z } from "zod";
import { preflight, withAppUser } from "@/lib/app-auth";

export const OPTIONS = preflight;

/** The signed-in person's latest notifications (new and changed jobs and so on). */
export async function GET(request: Request) {
  return withAppUser(request, async (tx, session) => {
    const rows = await tx
      .selectFrom("notifications")
      .select(["id", "event", "title", "body", "project_id", "read_at", "created_at"])
      .where("user_id", "=", session.userId)
      .orderBy("created_at", "desc")
      .limit(50)
      .execute();
    return Response.json({ notifications: rows });
  });
}

/** Mark notifications read: { ids } or { all: true }. */
export async function POST(request: Request) {
  const body = z.union([z.object({ ids: z.array(z.uuid()).max(100) }), z.object({ all: z.literal(true) })]).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Bad request" }, { status: 400 });
  return withAppUser(request, async (tx, session) => {
    let q = tx.updateTable("notifications").set({ read_at: sql<Date>`now()` }).where("user_id", "=", session.userId).where("read_at", "is", null);
    if ("ids" in body.data) q = q.where("id", "in", body.data.ids.length ? body.data.ids : ["00000000-0000-0000-0000-000000000000"]);
    await q.execute();
    return Response.json({ ok: true });
  });
}
