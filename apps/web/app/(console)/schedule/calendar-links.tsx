"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { teamCalendarLinkAction } from "@/lib/actions/bookings";

/** A team's private calendar feed link, to paste into Google, Outlook or Apple Calendar. */
export function CalendarLink({ teamId, teamName, hasLink }: { teamId: string; teamName: string; hasLink: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const get = (rotate: boolean) =>
    start(async () => {
      const r = await teamCalendarLinkAction(teamId, rotate);
      setError(r.error ?? null);
      if (r.url) {
        setUrl(r.url);
        await navigator.clipboard?.writeText(r.url).catch(() => undefined);
      }
    });
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{teamName}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => get(false)}>
            {hasLink || url ? "Copy calendar link" : "Create calendar link"}
          </Button>
          {(hasLink || url) && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => get(true)} title="The old link stops working">
              New link
            </Button>
          )}
        </div>
      </div>
      {url && <Input readOnly value={url} aria-label={`${teamName} calendar link`} onFocus={(e) => e.currentTarget.select()} />}
      {url && <p className="text-xs text-muted-foreground">Copied. In Google Calendar: Other calendars › From URL. In Outlook: Add calendar › Subscribe from web.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
