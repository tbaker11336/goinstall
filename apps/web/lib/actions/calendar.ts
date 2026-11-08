"use server";

import { sql, withService } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionResult } from "./crm";

const ALL = ["admin", "office", "installer", "subcontractor"] as const;

/** Stop sending bookings to my Google Calendar (events already there stay). */
export async function disconnectCalendarAction(): Promise<ActionResult> {
  const row = await asUser((tx, s) => tx.selectFrom("integrations").select(["id", "company_id"]).where("provider", "=", "google_calendar").where("user_id", "=", s.userId).executeTakeFirst(), [...ALL]);
  if (!row) return { error: "Your calendar isn't connected." };
  await withService(db(), async (tx) => {
    await sql`delete from private.integration_secrets where integration_id = ${row.id}`.execute(tx);
    await tx.updateTable("integrations").set({ status: "disconnected" }).where("id", "=", row.id).where("company_id", "=", row.company_id).execute();
  });
  revalidatePath("/my-calendar");
  return { message: "Google Calendar disconnected. Events already added stay in your calendar." };
}
