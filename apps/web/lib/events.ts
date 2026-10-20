import { CONTACT_STAGE_LABELS, stageLabel, type ContactStage, type ProjectStage } from "@goinstall/core";

/** Human-readable line for an activity_log event. */
export function describeEvent(event: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, string | undefined>;
  switch (event) {
    case "project_created":
      return "Project created";
    case "stage_changed":
      return p.to === "lost"
        ? `Marked lost${p.lost_reason ? `: ${p.lost_reason}` : ""}`
        : `Stage changed from ${stageLabel(p.from as ProjectStage)} to ${stageLabel(p.to as ProjectStage)}`;
    case "contact_stage_changed":
      return `Moved from ${CONTACT_STAGE_LABELS[p.from as ContactStage]} to ${CONTACT_STAGE_LABELS[p.to as ContactStage]}`;
    default:
      return event.replaceAll("_", " ");
  }
}
