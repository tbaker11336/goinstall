import { withService } from "@goinstall/db";
import { z } from "zod";
import { preflight, withAppUser } from "@/lib/app-auth";
import { db } from "@/lib/db";

export const OPTIONS = preflight;

const deviceSchema = z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/), platform: z.enum(["ios", "android"]) });

/**
 * The app registers its push token after sign-in. A phone belongs to
 * whoever signed in on it last, so the token moves to this person (a service
 * write, as the old row may be someone else's).
 */
export async function POST(request: Request) {
  const body = deviceSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Bad request" }, { status: 400 });
  return withAppUser(request, async (_tx, session) => {
    await withService(db(), async (tx) => {
      await tx.deleteFrom("push_devices").where("token", "=", body.data.token).where("user_id", "!=", session.userId).execute();
      await tx
        .insertInto("push_devices")
        .values({ company_id: session.companyId, user_id: session.userId, token: body.data.token, platform: body.data.platform, created_by: session.userId })
        .onConflict((oc) => oc.column("token").doUpdateSet({ last_seen_at: new Date(), platform: body.data.platform }))
        .execute();
    });
    return Response.json({ ok: true });
  });
}

/** Signing out stops pushes to this phone. */
export async function DELETE(request: Request) {
  const body = z.object({ token: z.string().max(200) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Bad request" }, { status: 400 });
  return withAppUser(request, async (tx, session) => {
    await tx.deleteFrom("push_devices").where("token", "=", body.data.token).where("user_id", "=", session.userId).execute();
    return Response.json({ ok: true });
  });
}
