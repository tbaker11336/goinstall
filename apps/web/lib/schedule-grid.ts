import { addDays, BOOKING_TYPE_LABELS, bookingDates, weekDays } from "@goinstall/core";
import type { GridBooking, GridRow } from "@/components/week-grid";
import type { ScheduleBooking } from "./schedule";

const PRODUCT_LABEL: Record<string, string> = { solar: "Solar", battery: "battery", ev: "EV" };

export function weekColumns(monday: string) {
  return weekDays(monday, 5).map((date) => ({ date, label: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }) }));
}

/** Rows (teams, scaffold, surveys, unassigned) and positioned bookings for a week. */
export function gridFor(
  monday: string,
  bookings: ScheduleBooking[],
  teams: { id: string; name: string }[],
  opts: { highlightProjectId?: string; linkProjects?: boolean; userNames?: Map<string, string> } = {},
): { rows: GridRow[]; items: GridBooking[] } {
  const days = weekDays(monday, 5);
  const last = addDays(monday, 4);
  const rows: GridRow[] = teams.map((t) => ({ key: `team:${t.id}`, label: t.name, teamId: t.id }));
  const items: GridBooking[] = [];
  const used = new Set<string>();
  const names = new Map(bookings.map((b) => [b.id, b.address ?? b.title ?? BOOKING_TYPE_LABELS[b.type]]));
  for (const b of bookings) {
    const covered = bookingDates(b.startsAt, b.endsAt).filter((d) => d >= monday && d <= last);
    if (!covered.length) continue;
    const team = b.assignments.find((a) => a.role === "team" && a.teamId);
    const rowKey = b.type === "scaffold_up" || b.type === "scaffold_down" ? "scaffold" : b.type === "survey" ? "survey" : team ? `team:${team.teamId}` : "unassigned";
    used.add(rowKey);
    const isThis = opts.highlightProjectId && b.projectId === opts.highlightProjectId;
    const productsText = b.products.map((p) => PRODUCT_LABEL[p] ?? p).join(", ").replace(/^./, (c) => c.toUpperCase());
    const scaffolder = b.assignments.find((a) => a.role === "scaffolder")?.name;
    const surveyor = b.assignments.find((a) => a.role === "surveyor")?.name;
    const clash = b.clashes[0];
    items.push({
      id: b.id,
      rowKey,
      start: days.indexOf(covered[0]!),
      span: covered.length,
      title:
        b.type === "scaffold_up" || b.type === "scaffold_down"
          ? `${b.type === "scaffold_up" ? "Up" : "Down"} · ${b.address ?? ""}`
          : `${b.address ?? b.title ?? BOOKING_TYPE_LABELS[b.type]}${isThis ? " · this job" : ""}`,
      subtitle:
        b.type === "scaffold_up" || b.type === "scaffold_down"
          ? (scaffolder ?? "No scaffolder")
          : b.type === "survey"
            ? `Survey${surveyor ? ` · ${surveyor}` : ""}`
            : `${productsText}${covered.length > 1 ? ` · ${covered.length} days` : ""}${b.status === "tentative" ? " · pencilled" : ""}`,
      tone: isThis ? "this" : b.type === "survey" ? "survey" : rowKey === "scaffold" ? "scaffold" : "other",
      clash: clash ? `Clash with ${names.get(clash.with) ?? "another booking"}` : null,
      href: opts.linkProjects && b.projectId ? `/projects/${b.projectId}/install` : undefined,
      draggable: true,
    });
  }
  if (used.has("unassigned")) rows.push({ key: "unassigned", label: "No team yet", teamId: null });
  rows.push({ key: "scaffold", label: "Scaffold", teamId: null });
  if (used.has("survey")) rows.push({ key: "survey", label: "Surveys", teamId: null });
  return { rows, items };
}
