import { sql } from "@goinstall/db";
import { redirect } from "next/navigation";
import { z } from "zod";
import { asUser } from "@/lib/auth";

/** Open a notification: mark it read and go where it points (always inside the console). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) redirect("/notifications");
  const n = await asUser((tx) => tx.updateTable("notifications").set({ read_at: sql<Date>`coalesce(read_at, now())` }).where("id", "=", id).returning("link").executeTakeFirst());
  redirect(n?.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/notifications");
}
