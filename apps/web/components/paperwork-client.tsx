"use client";

import { useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { generateAllPaperworkAction, generatePaperworkAction, removePaperworkFileAction, sendHandoverPackAction } from "@/lib/actions/paperwork";

function useRun() {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  return { pending, state, run: (fn: () => Promise<FormState>) => start(async () => setState(await fn())) };
}

function RunButton({ label, pendingLabel, action, variant = "outline", className }: { label: string; pendingLabel: string; action: () => Promise<FormState>; variant?: "outline" | "default"; className?: string }) {
  const { pending, state, run } = useRun();
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant={variant} disabled={pending} onClick={() => run(action)} className={className}>
        {pending ? pendingLabel : label}
      </Button>
      <FormMessage state={state} />
    </div>
  );
}

export function GenerateAllButton({ projectId }: { projectId: string }) {
  return <RunButton label="Generate forms" pendingLabel="Generating…" action={() => generateAllPaperworkAction(projectId)} className="w-full" />;
}

export function GenerateItemButton({ itemId, label }: { itemId: string; label: string }) {
  return <RunButton label={label} pendingLabel="Making…" action={() => generatePaperworkAction(itemId)} />;
}

export function SendHandoverButton({ projectId }: { projectId: string }) {
  return <RunButton label="Email pack to the customer" pendingLabel="Sending…" variant="default" action={() => sendHandoverPackAction(projectId)} />;
}

export function RemoveFileButton({ fileId, name }: { fileId: string; name: string }) {
  const { pending, run } = useRun();
  return (
    <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${name}`} onClick={() => run(() => removePaperworkFileAction(fileId))}>
      Remove
    </Button>
  );
}
