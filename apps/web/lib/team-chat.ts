import "server-only";
import { withService, type Tx } from "@goinstall/db";
import { db } from "./db";
import { notifyTeam } from "./notify";

/**
 * Chat about a job between the office and the people booked on it. Reads go
 * through the caller's connection (RLS decides who sees which job); the
 * notification after a send uses a service connection and names the company.
 */

export interface ChatMessage {
  id: string;
  authorId: string;
  author: string;
  role: string;
  body: string;
  sentAt: string;
}

export async function loadChat(tx: Tx, projectId: string): Promise<ChatMessage[]> {
  const rows = await tx
    .selectFrom("team_messages as m")
    .innerJoin("users as u", (j) => j.onRef("u.id", "=", "m.author_id").onRef("u.company_id", "=", "m.company_id"))
    .select(["m.id", "m.author_id", "u.full_name", "u.role", "m.body", "m.sent_at"])
    .where("m.project_id", "=", projectId)
    .orderBy("m.sent_at")
    .limit(500)
    .execute();
  return rows.map((r) => ({ id: r.id, authorId: r.author_id, author: r.full_name, role: r.role, body: r.body, sentAt: r.sent_at.toISOString() }));
}

/** Store a message (idempotent on its id, made by the sender's device or browser). False if it was already there. */
export async function saveChatMessage(tx: Tx, m: { id: string; projectId: string; authorId: string; body: string; sentAt: Date }): Promise<boolean> {
  const r = await tx
    .insertInto("team_messages")
    .values({ id: m.id, project_id: m.projectId, author_id: m.authorId, body: m.body, sent_at: m.sentAt })
    .onConflict((oc) => oc.column("id").doNothing())
    .executeTakeFirst();
  await markChatRead(tx, m.projectId, m.authorId, m.sentAt);
  return Number(r.numInsertedOrUpdatedRows ?? 0) > 0;
}

export async function markChatRead(tx: Tx, projectId: string, userId: string, at = new Date()) {
  await tx
    .insertInto("team_message_reads")
    .values({ project_id: projectId, user_id: userId, read_at: at })
    .onConflict((oc) => oc.columns(["company_id", "project_id", "user_id"]).doUpdateSet((eb) => ({ read_at: eb.fn("greatest", ["team_message_reads.read_at", eb.ref("excluded.read_at")]) })))
    .execute();
}

/**
 * Tell the other side: office messages go to everyone booked on the job's
 * open bookings (named or through their team); installers' messages go to
 * the project owner (or the office) and the others on the job.
 */
export async function notifyChat(companyId: string, projectId: string, author: { id: string; name: string; staff: boolean }, body: string): Promise<void> {
  const crew = await withService(db(), async (tx) => {
    const rows = await tx
      .selectFrom("booking_assignments as a")
      .innerJoin("bookings as b", (j) => j.onRef("b.id", "=", "a.booking_id").onRef("b.company_id", "=", "a.company_id"))
      .leftJoin("users as tm", (j) => j.onRef("tm.team_id", "=", "a.team_id").onRef("tm.company_id", "=", "a.company_id"))
      .select(["a.user_id", "tm.id as member_id"])
      .where("b.project_id", "=", projectId)
      .where("b.company_id", "=", companyId)
      .where("b.status", "not in", ["cancelled", "completed"])
      .execute();
    return [...new Set(rows.flatMap((r) => [r.user_id, r.member_id]).filter((x): x is string => Boolean(x)))];
  });
  const preview = body.length > 200 ? `${body.slice(0, 197)}…` : body;
  const data = { installer: author.name, detail: `${author.name}: ${preview}` };
  if (author.staff) {
    if (crew.length) await notifyTeam(companyId, "team_message", { projectId, recipients: crew, exclude: author.id, link: `/projects/${projectId}/install`, data });
  } else {
    await notifyTeam(companyId, "team_message", { projectId, exclude: author.id, link: `/projects/${projectId}/install#team-chat`, data });
    const others = crew.filter((u) => u !== author.id);
    if (others.length) await notifyTeam(companyId, "team_message", { projectId, recipients: others, link: `/projects/${projectId}/install`, data });
  }
}
