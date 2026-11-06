"use client";

import { LENGTH_LIMITS, LENGTH_UNITS, type LengthUnit } from "@goinstall/core";
import { useState } from "react";
import { Field, Input, Select } from "@/components/ui/input";

const UNIT_LABELS: Record<LengthUnit, string> = { hours: "Hours", days: "Working days", weeks: "Working weeks" };

/** Length of a job in hours (with a start time), working days or working weeks. */
export function BookingLength({ prefix, value, unit, startTime }: { prefix: string; value: number; unit: LengthUnit; startTime: string }) {
  const [u, setU] = useState<LengthUnit>(unit);
  return (
    <>
      <Field label="Length" htmlFor={`${prefix}length`}>
        <div className="flex gap-2">
          <Input id={`${prefix}length`} name="length" type="number" inputMode="decimal" min={u === "hours" ? 0.25 : 1} step={u === "hours" ? 0.25 : u === "days" ? 1 : 0.5} max={LENGTH_LIMITS[u]} required defaultValue={value} className="w-20" />
          <label htmlFor={`${prefix}unit`} className="sr-only">
            Length in
          </label>
          <Select id={`${prefix}unit`} name="length_unit" value={u} onChange={(e) => setU(e.target.value as LengthUnit)} className="w-auto">
            {LENGTH_UNITS.map((x) => (
              <option key={x} value={x}>
                {UNIT_LABELS[x]}
              </option>
            ))}
          </Select>
        </div>
      </Field>
      {u === "hours" && (
        <Field label="Start time" htmlFor={`${prefix}time`}>
          <Input id={`${prefix}time`} name="start_time" type="time" required defaultValue={startTime || "08:30"} />
        </Field>
      )}
    </>
  );
}
