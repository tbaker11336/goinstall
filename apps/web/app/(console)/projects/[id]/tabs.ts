import { stageIndex, type ActiveProjectStage, type ProjectStage } from "@goinstall/core";

export const PROJECT_TABS = [
  { slug: "", label: "Overview", doneAt: null, phase: null },
  { slug: "survey", label: "Survey", doneAt: "design", phase: 2 },
  { slug: "design", label: "Design", doneAt: "proposal_sent", phase: 3 },
  { slug: "proposal", label: "Proposal", doneAt: "accepted", phase: 4 },
  { slug: "kit", label: "Kit & suppliers", doneAt: "kit_ordered", phase: 5 },
  { slug: "install", label: "Install & paperwork", doneAt: "complete", phase: 5 },
] as const satisfies readonly { slug: string; label: string; doneAt: ActiveProjectStage | null; phase: number | null }[];

/** A tab shows a tick once the project has reached the stage after it. */
export function tabDone(doneAt: ActiveProjectStage | null, stage: ProjectStage, lostFrom: ProjectStage | null): boolean {
  if (!doneAt) return false;
  const effective = stage === "lost" ? lostFrom : stage;
  if (!effective || effective === "lost") return false;
  return stageIndex(effective) >= stageIndex(doneAt);
}
