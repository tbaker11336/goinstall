import { sql } from "@goinstall/db";
import { z } from "zod";
import { preflight, withAppUser } from "@/lib/app-auth";
import { applyOp, opSchema, type OpResult } from "@/lib/app-sync";
import { completeInstall } from "@/lib/completion";

export const OPTIONS = preflight;

/** Replay the device's queued captures. Each op is applied in its own savepoint so one bad op doesn't block the rest. */
export async function POST(request: Request) {
  const body = z.object({ ops: z.array(z.unknown()).max(500) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const completed = new Set<string>();
  const followUps: (() => Promise<void>)[] = [];
  let companyId: string | null = null;
  const response = await withAppUser(request, async (tx, session) => {
    companyId = session.companyId;
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
        results.push(await applyOp(tx, session, op.data, completed, followUps));
        await sql`release savepoint app_op`.execute(tx);
      } catch (err) {
        await sql`rollback to savepoint app_op`.execute(tx);
        results.push({ opId, ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "Failed" });
      }
    }
    return Response.json({ results });
  });
  // Committed: now the paperwork, stage and balance invoice that follow an install.
  if (response.ok) for (const f of followUps) await f().catch((err) => console.error("sync follow-up failed", err));
  if (response.ok && companyId) {
    for (const projectId of completed) {
      await completeInstall(companyId, projectId).catch((err) => console.error("completeInstall failed", projectId, err));
    }
  }
  return response;
}
