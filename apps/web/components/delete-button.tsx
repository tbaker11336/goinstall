"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { deleteContactAction, deleteProjectAction } from "@/lib/actions/delete";

/**
 * "Delete" with a second, explicit confirmation listing what goes. Shown to
 * admins only (the database refuses anyone else).
 */
export function DeleteRecord({ kind, id, name, consequences }: { kind: "project" | "contact"; id: string; name: string; consequences: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <Button type="button" variant="ghost" size="sm" className="w-fit text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" aria-hidden /> Delete {kind}
        </Button>
      ) : (
        <div role="alertdialog" aria-labelledby={`del-${id}`} aria-describedby={`del-${id}-desc`} className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-3">
          <p id={`del-${id}`} className="font-semibold text-red-900">
            Delete {name} permanently?
          </p>
          <p id={`del-${id}-desc`} className="text-sm text-red-900">
            {consequences} This can&apos;t be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="bg-red-700 text-white hover:bg-red-800"
              disabled={pending}
              onClick={() => start(async () => setState((await (kind === "project" ? deleteProjectAction(id) : deleteContactAction(id))) ?? {}))}
            >
              {pending ? "Deleting…" : `Yes, delete ${kind}`}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Keep it
            </Button>
          </div>
          <FormMessage state={state} />
        </div>
      )}
    </div>
  );
}
