"use server";

import { normaliseSettings, NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, type NotificationChannel } from "@goinstall/core";
import { sql } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/auth";
import type { ActionResult } from "./crm";

export async function markAllReadAction(): Promise<ActionResult> {
  await asUser((tx, session) => tx.updateTable("notifications").set({ read_at: sql<Date>`now()` }).where("user_id", "=", session.userId).where("read_at", "is", null).execute());
  revalidatePath("/", "layout");
  return { message: "All marked as read." };
}

/** Settings › Notifications: channels per event and the reminder timings (blank = off). */
export async function saveNotificationSettingsAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const events: Record<string, NotificationChannel[]> = {};
  for (const e of NOTIFICATION_EVENTS) events[e.key] = NOTIFICATION_CHANNELS.filter((c) => form.get(`${e.key}:${c}`) === "on");
  const day = (k: string, max: number): number | null | "bad" => {
    const v = String(form.get(k) ?? "").trim();
    if (!v) return null;
    return /^\d+$/.test(v) && Number(v) <= max ? Number(v) : "bad";
  };
  const survey = day("surveyDays", 60);
  const install = day("installDaysBefore", 14);
  const proposal = String(form.get("proposalDays") ?? "").split(/[,\s]+/).filter(Boolean);
  if (survey === "bad" || install === "bad" || proposal.some((p) => !/^\d+$/.test(p) || Number(p) < 1 || Number(p) > 90))
    return { error: "Reminder timings are whole numbers of days (survey up to 60, proposal 1 to 90, install up to 14), or blank for off." };
  if (proposal.length > 3) return { error: "Up to three proposal reminders." };
  const settings = normaliseSettings({ events, reminders: { surveyDays: survey, proposalDays: proposal.map(Number), installDaysBefore: install } });
  return asUser(async (tx, session) => {
    await tx.updateTable("companies").set({ notification_settings: JSON.stringify(settings) }).where("id", "=", session.companyId).execute();
    revalidatePath("/settings/notifications");
    return { message: "Notification settings saved." };
  }, ["admin"]);
}
