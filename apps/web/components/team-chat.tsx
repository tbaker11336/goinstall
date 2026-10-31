"use client";

import { useEffect, useRef } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Textarea } from "@/components/ui/input";
import { sendTeamMessageAction } from "@/lib/actions/bookings";
import { cn } from "@/lib/utils";

export interface TeamChatMessage {
  id: string;
  authorId: string;
  author: string;
  role: string;
  body: string;
  sentAt: string;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/** The office side of a job's chat with the installers. */
export function TeamChat({ projectId, me, messages }: { projectId: string; me: string; messages: TeamChatMessage[] }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages.length]);
  return (
    <div className="flex flex-col gap-3">
      {messages.length ? (
        <ol ref={list} aria-label="Messages" className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-md bg-surface-subtle p-3">
          {messages.map((m) => {
            const mine = m.authorId === me;
            const office = m.role === "admin" || m.role === "office";
            return (
              <li key={m.id} className={cn("flex max-w-[85%] flex-col gap-0.5", mine ? "self-end items-end" : "self-start")}>
                <span className="text-xs text-ink-3">
                  {mine ? "You" : m.author}
                  {!mine && !office && " · installer"} · {when(m.sentAt)}
                </span>
                <p className={cn("rounded-lg px-3 py-2 text-sm whitespace-pre-line", mine ? "bg-primary text-primary-foreground" : office ? "bg-card" : "bg-accent-tint text-accent-deep")}>{m.body}</p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No messages yet.</p>
      )}
      <ActionForm action={sendTeamMessageAction.bind(null, projectId)} resetOnSuccess className="flex flex-col gap-2">
        <label htmlFor="team-message" className="sr-only">
          Message to the team
        </label>
        <Textarea id="team-message" name="body" rows={2} maxLength={2000} placeholder="e.g. Scaffold is up; key safe code is with the customer" required />
        <div>
          <SubmitButton pendingText="Sending…">Send to the team</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
