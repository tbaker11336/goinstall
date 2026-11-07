"use client";

import { BOARD_FIELDS, CIRCUIT_FIELDS, MAX_CIRCUITS, type TestValues } from "@goinstall/core";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { deleteTestBoardAction, saveTestBoardAction } from "@/lib/actions/handover";

/**
 * Type in (or correct) a board's details and its circuit results. Every
 * value is free text, as written on the sheet: nothing is filled in for you.
 */
export function TestBoardEditor({ projectId, boardId, initial }: { projectId: string; boardId: string | null; initial: { board: TestValues; circuits: TestValues[] } }) {
  const router = useRouter();
  const [board, setBoard] = useState<TestValues>(initial.board);
  const [circuits, setCircuits] = useState<TestValues[]>(initial.circuits.length ? initial.circuits : [{}]);
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  const p = boardId ? boardId.slice(0, 8) : "new";
  const setCell = (i: number, key: string, v: string) => setCircuits((cs) => cs.map((c, j) => (j === i ? { ...c, [key]: v } : c)));

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <legend className="mb-2 text-sm font-bold">Distribution board</legend>
        {BOARD_FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label htmlFor={`tb-${p}-${f.key}`} className="text-[13px] text-ink-2">
              {f.label}
              {f.unit ? ` (${f.unit})` : ""}
            </label>
            <Input id={`tb-${p}-${f.key}`} value={board[f.key] ?? ""} onChange={(e) => setBoard((b) => ({ ...b, [f.key]: e.target.value }))} className="h-9" />
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-bold">Circuits and test results</h4>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-max border-collapse text-xs">
            <caption className="sr-only">Circuits</caption>
            <thead>
              <tr className="bg-surface-subtle">
                {CIRCUIT_FIELDS.map((f) => (
                  <th key={f.key} scope="col" title={f.label} className="border-b px-1.5 py-1 text-left font-medium whitespace-nowrap">
                    {f.short}
                    {f.unit ? <span className="font-normal text-ink-3"> {f.unit}</span> : null}
                  </th>
                ))}
                <th className="border-b px-1.5">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {circuits.map((c, i) => (
                <tr key={i} className="border-b last:border-b-0">
                  {CIRCUIT_FIELDS.map((f) => (
                    <td key={f.key} className="px-1 py-1">
                      {f.options ? (
                        <Select aria-label={`Circuit ${i + 1}: ${f.label}`} value={c[f.key] ?? ""} onChange={(e) => setCell(i, f.key, e.target.value)} className="h-8 w-16 px-1 text-xs">
                          <option value="">—</option>
                          {f.options.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </Select>
                      ) : (
                        <Input aria-label={`Circuit ${i + 1}: ${f.label}`} value={c[f.key] ?? ""} onChange={(e) => setCell(i, f.key, e.target.value)} className={`h-8 px-1.5 text-xs ${f.key === "designation" ? "w-40" : "w-16"}`} />
                      )}
                    </td>
                  ))}
                  <td className="px-1">
                    <Button type="button" size="icon" variant="ghost" aria-label={`Remove circuit ${i + 1}`} onClick={() => setCircuits((cs) => cs.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" disabled={circuits.length >= MAX_CIRCUITS} onClick={() => setCircuits((cs) => [...cs, { ref: String(cs.length + 1) }])}>
            <Plus className="size-4" aria-hidden /> Add circuit
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveTestBoardAction(projectId, boardId, { board, circuits });
              setState(r);
              if (!r.error) router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save test results"}
        </Button>
        {boardId && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!window.confirm("Remove this board and its results?")) return;
                const r = await deleteTestBoardAction(boardId);
                setState(r);
                router.refresh();
              })
            }
          >
            Remove board
          </Button>
        )}
      </div>
      <FormMessage state={state} />
    </div>
  );
}
