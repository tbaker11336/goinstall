/**
 * Project and contact stage workflow. These must stay in step with the
 * project_stage and contact_stage enums in supabase/migrations.
 */

export const PROJECT_STAGES = [
  "enquiry",
  "survey",
  "design",
  "proposal_sent",
  "accepted",
  "deposit_paid",
  "kit_ordered",
  "scheduled",
  "complete",
] as const;

export type ActiveProjectStage = (typeof PROJECT_STAGES)[number];
export type ProjectStage = ActiveProjectStage | "lost";

export const CONTACT_STAGES = [
  "new_enquiry",
  "survey",
  "design",
  "proposal_sent",
  "won",
  "lost",
] as const;

export type ContactStage = (typeof CONTACT_STAGES)[number];

interface StageInfo {
  label: string;
  /** Selling stages can end in Lost; delivery stages cannot. */
  phase: "selling" | "delivery";
  /** What normally moves a project into this stage. */
  enteredWhen: string;
  /** Primary action shown on the project's "Next step" card. */
  nextAction: string | null;
}

export const PROJECT_STAGE_INFO: Record<ActiveProjectStage, StageInfo> = {
  enquiry: {
    label: "Enquiry",
    phase: "selling",
    enteredWhen: "Contact and project created",
    nextAction: "Send survey link or book a survey",
  },
  survey: {
    label: "Survey",
    phase: "selling",
    enteredWhen: "Online survey sent or in-person survey booked",
    nextAction: "Mark survey complete",
  },
  design: {
    label: "Design",
    phase: "selling",
    enteredWhen: "Survey marked complete",
    nextAction: "Create proposal from design",
  },
  proposal_sent: {
    label: "Proposal sent",
    phase: "selling",
    enteredWhen: "Proposal sent to customer",
    nextAction: "Follow up on proposal",
  },
  accepted: {
    label: "Accepted",
    phase: "selling",
    enteredWhen: "Customer accepts and signs",
    nextAction: "Chase deposit payment",
  },
  deposit_paid: {
    label: "Deposit paid",
    phase: "delivery",
    enteredWhen: "Stripe confirms the deposit payment",
    nextAction: "Order kit",
  },
  kit_ordered: {
    label: "Kit ordered",
    phase: "delivery",
    enteredWhen: "Purchase orders placed",
    nextAction: "Book install",
  },
  scheduled: {
    label: "Scheduled",
    phase: "delivery",
    enteredWhen: "Install booking confirmed with a team",
    nextAction: "Complete install",
  },
  complete: {
    label: "Paperwork / complete",
    phase: "delivery",
    enteredWhen: "Installer completes the job in the app",
    nextAction: null,
  },
};

export const CONTACT_STAGE_LABELS: Record<ContactStage, string> = {
  new_enquiry: "New enquiry",
  survey: "Survey",
  design: "Design",
  proposal_sent: "Proposal sent",
  won: "Won (deposit paid)",
  lost: "Lost",
};

export function stageLabel(stage: ProjectStage): string {
  return stage === "lost" ? "Lost" : PROJECT_STAGE_INFO[stage].label;
}

export function stageIndex(stage: ActiveProjectStage): number {
  return PROJECT_STAGES.indexOf(stage);
}

export function canMarkLost(stage: ProjectStage): boolean {
  return stage !== "lost" && PROJECT_STAGE_INFO[stage].phase === "selling";
}

export function nextStage(stage: ProjectStage): ActiveProjectStage | null {
  if (stage === "lost") return null;
  return PROJECT_STAGES[stageIndex(stage) + 1] ?? null;
}

export type StageChangeResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/**
 * Check a stage change requested by a member of staff. Staff may move a
 * project back to correct mistakes, mark it lost before the deposit is paid,
 * or reopen it. Moving forward by hand is allowed but warned about, because
 * those stages are normally set by an event (survey submitted, Stripe payment,
 * installer completing the job).
 */
export function validateStageChange(
  from: ProjectStage,
  to: ProjectStage,
  opts: { lostReason?: string | null } = {},
): StageChangeResult {
  if (from === to) return { ok: false, error: "The project is already at this stage." };

  if (to === "lost") {
    if (!canMarkLost(from)) {
      return { ok: false, error: "A project cannot be marked lost once the deposit is paid." };
    }
    if (!opts.lostReason?.trim()) return { ok: false, error: "Give a reason for marking the project lost." };
    return { ok: true };
  }

  if (from === "lost") return { ok: true };

  if (stageIndex(to) > stageIndex(from)) {
    const skipped = stageIndex(to) - stageIndex(from) - 1;
    return {
      ok: true,
      warning:
        `"${stageLabel(to)}" is normally set automatically when: ${PROJECT_STAGE_INFO[to].enteredWhen.toLowerCase()}.` +
        (skipped > 0 ? ` This skips ${skipped} stage${skipped === 1 ? "" : "s"}.` : ""),
    };
  }

  return { ok: true };
}

/** Kanban column for a contact whose project is at the given stage. */
export function contactStageForProject(stage: ProjectStage): ContactStage {
  switch (stage) {
    case "enquiry":
      return "new_enquiry";
    case "survey":
    case "design":
    case "proposal_sent":
    case "lost":
      return stage;
    case "accepted":
      return "proposal_sent";
    default:
      return "won";
  }
}

/**
 * A contact's Kanban column from all of their projects: the most advanced
 * open project wins; the contact is lost only if every project is lost.
 * Returns null when the contact has no projects (keep the stored stage).
 */
export function contactStageFromProjects(stages: readonly ProjectStage[]): ContactStage | null {
  if (stages.length === 0) return null;
  const open = stages.filter((s): s is ActiveProjectStage => s !== "lost");
  if (open.length === 0) return "lost";
  const furthest = open.reduce((a, b) => (stageIndex(b) > stageIndex(a) ? b : a));
  return contactStageForProject(furthest);
}
