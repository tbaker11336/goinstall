"use client";

import { canMarkLost, nextStage, PROJECT_STAGE_INFO, PROJECT_STAGES, stageLabel, validateStageChange, type ProjectStage } from "@goinstall/core";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { changeProjectStageAction } from "@/lib/actions/crm";

/**
 * "Next step" card actions: move to the next stage, move to any stage
 * (with a warning when skipping an event-driven stage), or mark lost.
 */
export function StageControls({ projectId, stage, lostFromStage }: { projectId: string; stage: ProjectStage; lostFromStage: ProjectStage | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const lostDialog = useRef<HTMLDialogElement>(null);
  const next = nextStage(stage);

  function change(to: ProjectStage, lostReason?: string) {
    const check = validateStageChange(stage, to, { lostReason });
    if (!check.ok) return setError(check.error);
    if (check.warning && !window.confirm(`${check.warning}\n\nMove the project anyway?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await changeProjectStageAction(projectId, to, lostReason);
      if (result.error) setError(result.error);
    });
  }

  if (stage === "lost") {
    const reopenTo = lostFromStage ?? "enquiry";
    return (
      <div className="grid gap-2">
        <Button onClick={() => change(reopenTo)} disabled={pending}>
          Reopen at {stageLabel(reopenTo)}
        </Button>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {next && (
        <Button onClick={() => change(next)} disabled={pending}>
          Move to {stageLabel(next)}
        </Button>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Or set stage" htmlFor="set-stage" className="flex-1">
          <Select
            id="set-stage"
            value={stage}
            disabled={pending}
            onChange={(e) => change(e.target.value as ProjectStage)}
          >
            {PROJECT_STAGES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STAGE_INFO[s].label}
              </option>
            ))}
          </Select>
        </Field>
        {canMarkLost(stage) && (
          <Button variant="outline" onClick={() => lostDialog.current?.showModal()} disabled={pending}>
            Mark lost
          </Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      <dialog ref={lostDialog} aria-labelledby="project-lost-title" className="m-auto w-full max-w-md rounded-lg border bg-card p-6 shadow-lg backdrop:bg-black/40">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
            lostDialog.current?.close();
            change("lost", reason);
          }}
        >
          <h2 id="project-lost-title" className="text-base font-semibold">
            Mark project as lost
          </h2>
          <Field label="Reason" htmlFor="project-lost-reason">
            <Input id="project-lost-reason" name="reason" required autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => lostDialog.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive">
              Mark lost
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
