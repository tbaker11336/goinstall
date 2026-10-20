"use client";

import { ArrowRight, Copy, Link2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import type { SurveyKind } from "@goinstall/core";
import { Button } from "@/components/ui/button";
import { createSurveyLinkAction, markSurveyCompleteAction, removePhotoAction, sendSurveyLinkAction } from "@/lib/actions/messaging";

function Feedback({ error, message }: { error?: string | null; message?: string | null }) {
  if (error)
    return (
      <p role="alert" className="text-sm text-red-800">
        {error}
      </p>
    );
  if (message)
    return (
      <p role="status" className="text-sm text-success-text">
        {message}
      </p>
    );
  return null;
}

/** Online survey card actions: email the link, or create one to paste into a text message. */
export function SurveyLinkActions({ projectId, kind, canEmail, sent }: { projectId: string; kind: SurveyKind; canEmail: boolean; sent: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string | null; message?: string | null }>({});
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2.5">
        <Button
          variant={sent ? "outline" : "default"}
          disabled={pending || !canEmail}
          title={canEmail ? undefined : "Add an email address to the contact first"}
          onClick={() => start(async () => setResult(await sendSurveyLinkAction(projectId, kind)))}
        >
          {sent ? "Resend link" : "Email survey link"}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await createSurveyLinkAction(projectId, kind);
              setUrl(r.url ?? null);
              setResult({ error: r.error });
            })
          }
        >
          <Link2 aria-hidden /> Create link to copy
        </Button>
      </div>
      {!canEmail && <p className="text-[13px] text-muted-foreground">Add an email address to the contact to email the link.</p>}
      {url && (
        <div className="flex gap-2">
          <label htmlFor="survey-url" className="sr-only">
            Survey link
          </label>
          <input id="survey-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-surface-subtle px-3 text-sm" />
          <Button variant="outline" onClick={() => navigator.clipboard.writeText(url).then(() => setResult({ message: "Link copied. Older links no longer work." }))}>
            <Copy aria-hidden /> Copy
          </Button>
        </div>
      )}
      <Feedback {...result} />
    </div>
  );
}

/** Header action: warn, but allow, when required answers or photos are missing. */
export function MarkCompleteButton({ projectId, kind, label, missing }: { projectId: string; kind: SurveyKind; label?: string; missing: string[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={pending}
        onClick={() => {
          if (missing.length && !window.confirm(`Still missing: ${missing.join(", ")}.\n\nMark the survey complete anyway?`)) return;
          start(async () => setError((await markSurveyCompleteAction(projectId, kind)).error ?? null));
        }}
      >
        {label ?? "Mark complete and design"} <ArrowRight aria-hidden />
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

export function RemovePhotoButton({ projectId, fileId, label }: { projectId: string; fileId: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Remove ${label} photo`}
      onClick={() => {
        if (window.confirm(`Remove this ${label} photo?`)) start(async () => void (await removePhotoAction(projectId, fileId)));
      }}
      className="absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
    >
      <Trash2 className="size-3.5" aria-hidden />
    </button>
  );
}
