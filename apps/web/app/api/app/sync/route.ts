import { sql } from "@goinstall/db";
import { z } from "zod";
import { preflight, withAppUser } from "@/lib/app-auth";
import { applyOp, opSchema, type OpResult } from "@/lib/app-sync";

export const OPTIONS = preflight;

/** Replay the device's queued captures. Each op is applied in its own savepoint so one bad op doesn't block the rest. */
export async function POST(request: Request) {
  const body = z.object({ ops: z.array(z.unknown()).max(500) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Bad request" }, { status: 400 });
  return withAppUser(request, async (tx, session) => {
    const results: OpResult[] = [];
    for (const raw of body.data.ops) {
      const op = opSchema.safeParse(raw);
      const opId = typeof raw === "object" && raw && "opId" in raw ? String((raw as { opId: unknown }).opId) : "";
      if (!op.success) {
        results.push({ opId, ok: false, error: op.error.issues[0]?.message ?? "Invalid" });
        continue;
      }
      await sql`savepoint app_op`.execute(tx);
      try {
        results.push(await applyOp(tx, session, op.data));
        await sql`release savepoint app_op`.execute(tx);
      } catch (err) {
        await sql`rollback to savepoint app_op`.execute(tx);
        results.push({ opId, ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "Failed" });
      }
    }
    return Response.json({ results });
  });
}
