import "server-only";
import { appendFile } from "node:fs/promises";
import { createExpoPush, createRecordingPush, type PushMessage, type PushSender } from "@goinstall/integrations";
import type { Tx } from "@goinstall/db";

const g = globalThis as unknown as { goinstallPush?: PushSender };

/**
 * Expo's push service; in development and tests PUSH_OUTBOX_FILE records
 * pushes instead. EXPO_ACCESS_TOKEN is optional (Expo's "enhanced security").
 */
export function pushSender(): PushSender {
  if (g.goinstallPush) return g.goinstallPush;
  const outbox = process.env.PUSH_OUTBOX_FILE;
  const fake = outbox && process.env.NODE_ENV !== "production" && !process.env.VERCEL;
  g.goinstallPush = fake ? createRecordingPush((m) => appendFile(outbox, `${JSON.stringify(m)}\n`)) : createExpoPush({ accessToken: process.env.EXPO_ACCESS_TOKEN || undefined });
  return g.goinstallPush;
}

/**
 * Push to these people's phones (service connection; every query names the
 * company). Tokens Expo has retired are removed. Never throws.
 */
export async function pushToUsers(tx: Tx, companyId: string, messages: { userId: string; title: string; body: string; data?: Record<string, string> }[]): Promise<void> {
  if (!messages.length) return;
  try {
    const devices = await tx
      .selectFrom("push_devices")
      .select(["user_id", "token"])
      .where("company_id", "=", companyId)
      .where("user_id", "in", [...new Set(messages.map((m) => m.userId))])
      .execute();
    const out: PushMessage[] = messages.flatMap((m) => devices.filter((d) => d.user_id === m.userId).map((d) => ({ to: d.token, title: m.title, body: m.body.slice(0, 240), data: m.data })));
    if (!out.length) return;
    const r = await pushSender().send(out);
    if (r.invalidTokens.length) await tx.deleteFrom("push_devices").where("company_id", "=", companyId).where("token", "in", r.invalidTokens).execute();
    if (r.errors.length) console.error("Push errors", r.errors.slice(0, 3));
  } catch (err) {
    console.error("Push failed", err);
  }
}
