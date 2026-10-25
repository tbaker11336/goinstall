"use client";

import { useState, useTransition } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { attachNumberAction, findNumbersAction } from "@/lib/actions/platform";

export function AttachNumber({ companyId, fake }: { companyId: string; fake: boolean }) {
  const [numbers, setNumbers] = useState<{ phoneNumber: string; locality: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contains, setContains] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Field label="Number contains (optional)" htmlFor={`c-${companyId}`}>
          <Input id={`c-${companyId}`} value={contains} onChange={(e) => setContains(e.target.value)} inputMode="numeric" className="w-40" />
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await findNumbersAction(contains);
              setNumbers(r.numbers ?? null);
              setError(r.error ?? null);
            })
          }
        >
          {pending ? "Searching…" : "Find numbers"}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {numbers && (
        <ActionForm action={attachNumberAction.bind(null, companyId)} className="grid gap-3 sm:grid-cols-3">
          <Field label="Number" htmlFor={`n-${companyId}`}>
            <Select id={`n-${companyId}`} name="phoneNumber" required>
              {numbers.map((n) => (
                <option key={n.phoneNumber} value={n.phoneNumber}>
                  {n.phoneNumber}
                  {n.locality ? ` · ${n.locality}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {!fake && (
            <>
              <Field label="Regulatory bundle SID" htmlFor={`b-${companyId}`} hint="Approved bundle for this business (BU…)">
                <Input id={`b-${companyId}`} name="bundleSid" required />
              </Field>
              <Field label="Address SID (if needed)" htmlFor={`a-${companyId}`}>
                <Input id={`a-${companyId}`} name="addressSid" />
              </Field>
            </>
          )}
          <div className="sm:col-span-3">
            <SubmitButton pendingText="Buying…">Buy and attach</SubmitButton>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
