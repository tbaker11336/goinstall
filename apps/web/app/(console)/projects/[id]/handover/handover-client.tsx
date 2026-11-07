"use client";

import { useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { removeHandoverFileAction } from "@/lib/actions/handover";

export function RemoveHandoverFile({ fileId, name }: { fileId: string; name: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  return (
    <>
      <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${name}`} onClick={() => start(async () => setState(await removeHandoverFileAction(fileId)))}>
        Remove
      </Button>
      <FormMessage state={state} />
    </>
  );
}
