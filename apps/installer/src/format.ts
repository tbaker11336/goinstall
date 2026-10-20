import type { Job } from "./types";

const TZ = "Europe/London";
export const ukDate = (d: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
export const timeOf = (d: string) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
export const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
export const longDay = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });

/** Dates the job covers (all-day jobs end at midnight after the last day). */
export function jobDates(j: Pick<Job, "startsAt" | "endsAt" | "allDay">): string[] {
  const out: string[] = [];
  // All-day jobs are stored at UTC midnight (see packages/core schedule.ts).
  const first = j.allDay ? j.startsAt.slice(0, 10) : ukDate(j.startsAt);
  const last = j.allDay ? new Date(new Date(j.endsAt).getTime() - 86_400_000).toISOString().slice(0, 10) : ukDate(new Date(new Date(j.endsAt).getTime() - 1));
  for (let d = first; d <= last && out.length < 60; d = addDays(d, 1)) out.push(d);
  return out;
}

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const TYPE_LABEL: Record<Job["type"], string> = { survey: "Site survey", install: "Install", scaffold_up: "Scaffold up", scaffold_down: "Scaffold down", task: "Task" };
export const PRODUCT_LABEL: Record<string, string> = { solar: "Solar", battery: "Battery", ev: "EV" };
