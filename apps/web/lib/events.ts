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
    case "survey_link_sent":
      return "Online survey link sent by email";
    case "survey_link_created":
      return "Online survey link created";
    case "online_survey_completed":
      return "Online survey completed";
    case "online_survey_updated":
      return "Online survey answers updated";
    case "site_visit_booked":
      return p.at ? `Site visit booked for ${new Date(p.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" })}` : "Site visit booked";
    case "survey_marked_complete":
      return "Survey marked complete";
    default:
      return event.replaceAll("_", " ");
  }
}
