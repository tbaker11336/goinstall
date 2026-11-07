"use client";

import type { LengthUnit } from "@goinstall/core";
import { AlignLeft, Clock, MapPin, Users } from "lucide-react";
import { useState } from "react";
import { BookingLength } from "@/components/booking-length";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { saveBookingAction } from "@/lib/actions/bookings";
import { cn } from "@/lib/utils";

export type InviteType = "install" | "scaffold_up" | "scaffold_down" | "survey" | "task";

export const INVITE_LABELS: Record<InviteType, string> = {
  install: "Install",
  scaffold_up: "Scaffold up",
  scaffold_down: "Scaffold down",
  survey: "Survey visit",
  task: "Other visit",
};

export interface InviteBooking {
  id: string;
  type: InviteType;
  title: string | null;
  startDate: string;
  startTime: string;
  length: { value: number; unit: LengthUnit };
  notes: string | null;
  teamId: string | null;
  electricianId: string | null;
  scaffolderId: string | null;
  surveyorId: string | null;
  engineerIds: string[];
}

interface People {
  teams: { id: string; name: string; members: string[] }[];
  users: { id: string; full_name: string; role: string }[];
}

/** Starting length for a new booking of each kind. */
function defaultLength(type: InviteType, projectLength: { value: number; unit: LengthUnit } | null): { value: number; unit: LengthUnit } {
  if (type === "install") return projectLength ?? { value: 2, unit: "days" };
  if (type === "survey" || type === "task") return { value: 2, unit: "hours" };
  return { value: 1, unit: "days" };
}

function Row({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
      <Icon className="mt-2 size-4 text-ink-3" aria-hidden />
      <div role="group" aria-label={label} className="flex flex-wrap items-end gap-3">
        {children}
      </div>
    </div>
  );
}

/**
 * A booking written like a calendar invite: what, when, where, who's
 * invited and a description. Saving tells the people on it (and asks them
 * to accept in the app).
 */
export function BookingInvite({
  projectId,
  prefix,
  types,
  defaultTitles,
  address,
  people,
  projectLength,
  booking,
  initialType,
}: {
  projectId: string;
  prefix: string;
  types: InviteType[];
  defaultTitles: Record<InviteType, string>;
  address: string | null;
  people: People;
  projectLength: { value: number; unit: LengthUnit } | null;
  booking?: InviteBooking;
  initialType?: InviteType;
}) {
  const [type, setType] = useState<InviteType>(booking?.type ?? initialType ?? types[0] ?? "install");
  const len = booking && booking.type === type ? booking.length : defaultLength(type, projectLength);
  const p = prefix;
  const users = people.users;
  return (
    <ActionForm action={saveBookingAction.bind(null, projectId, booking?.id ?? null)} className="flex flex-col gap-4" resetOnSuccess={!booking}>
      <input type="hidden" name="type" value={type} />
      <Field label="Title" htmlFor={`${p}title`}>
        <Input id={`${p}title`} name="title" defaultValue={booking?.title ?? ""} placeholder={defaultTitles[type]} className="text-base font-semibold" maxLength={120} />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Type</legend>
        <div className="flex flex-wrap gap-2">
          {types.map((t) => (
            <label key={t} className={cn("cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold has-focus-visible:ring-2 has-focus-visible:ring-ring", type === t ? "border-primary bg-accent-tint text-accent-strong" : "text-ink-2 hover:bg-muted")}>
              <input type="radio" name={`${p}type-choice`} value={t} checked={type === t} onChange={() => setType(t)} className="sr-only" />
              {INVITE_LABELS[t]}
            </label>
          ))}
        </div>
      </fieldset>

      <Row icon={Clock} label="When">
        <Field label="Start date" htmlFor={`${p}start`}>
          <Input id={`${p}start`} name="start_date" type="date" required defaultValue={booking?.startDate ?? ""} />
        </Field>
        <BookingLength key={`${type}-${len.unit}`} prefix={p} value={len.value} unit={len.unit} startTime={booking?.type === type ? booking.startTime : ""} />
      </Row>

      <Row icon={MapPin} label="Where">
        <p className="py-2 text-sm">{address ?? "No site address on the project yet."}</p>
      </Row>

      <Row icon={Users} label="Guests">
        {type === "install" && (
          <>
            <Field label="Install team" htmlFor={`${p}team`}>
              <Select id={`${p}team`} name="team_id" defaultValue={booking?.teamId ?? ""}>
                <option value="">None</option>
                {people.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.members.length ? ` · ${t.members.join(", ")}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Electrician sign-off" htmlFor={`${p}elec`}>
              <Select id={`${p}elec`} name="electrician_id" defaultValue={booking?.electricianId ?? ""}>
                <option value="">None</option>
                {users
                  .filter((u) => u.role !== "subcontractor")
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
              </Select>
            </Field>
          </>
        )}
        {(type === "install" || type === "task") && (
          <fieldset className="w-full">
            <legend className="mb-1.5 text-sm font-medium">Engineers</legend>
            <div className="flex flex-wrap gap-2">
              {users.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm has-checked:border-primary has-checked:bg-accent-tint">
                  <input type="checkbox" name="engineer_ids" value={u.id} defaultChecked={booking?.engineerIds.includes(u.id)} className="size-4 accent-primary" />
                  {u.full_name}
                  {u.role === "subcontractor" && <span className="text-xs text-muted-foreground">(subcontractor)</span>}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {(type === "scaffold_up" || type === "scaffold_down") && (
          <Field label="Scaffolder" htmlFor={`${p}scaf`}>
            <Select id={`${p}scaf`} name="scaffolder_id" defaultValue={booking?.scaffolderId ?? ""}>
              <option value="">None</option>
              {users
                .filter((u) => u.role === "subcontractor")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {type === "survey" && (
          <Field label="Surveyor" htmlFor={`${p}surveyor`}>
            <Select id={`${p}surveyor`} name="surveyor_id" defaultValue={booking?.surveyorId ?? ""}>
              <option value="">None</option>
              {users
                .filter((u) => u.role !== "subcontractor")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <p className="w-full text-xs text-muted-foreground">Everyone invited gets it in the installer app and is asked to accept or decline.</p>
      </Row>

      <Row icon={AlignLeft} label="Description">
        <Field label="Description (optional)" htmlFor={`${p}notes`} className="w-full">
          <Textarea id={`${p}notes`} name="notes" rows={3} defaultValue={booking?.notes ?? ""} placeholder="Access, parking, what to bring…" />
        </Field>
      </Row>

      <div>
        <SubmitButton>{booking ? "Save changes" : `Book ${INVITE_LABELS[type].toLowerCase()}`}</SubmitButton>
      </div>
    </ActionForm>
  );
}
