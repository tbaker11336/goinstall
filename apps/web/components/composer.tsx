"use client";

import { ClipboardList } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { FormMessage, SubmitButton, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { addNoteAction } from "@/lib/actions/crm";
import { sendEmailAction, sendSurveyLinkAction } from "@/lib/actions/messaging";

type Channel = "note" | "email";

/**
 * Contact page composer: internal notes and emails, a "Send survey link"
 * shortcut, and the team's saved templates.
 */
export function Composer({
  contactId,
  contactEmail,
  projects,
  templates,
  emailLive,
}: {
  contactId: string;
  contactEmail: string | null;
  projects: { id: string; label: string }[];
  templates: { id: string; name: string; subject: string | null; body: string }[];
  emailLive: boolean;
}) {
  const [channel, setChannel] = useState<Channel>(contactEmail ? "email" : "note");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [noteState, noteAction] = useActionState<FormState, FormData>(addNoteAction.bind(null, contactId), {});
  const [emailState, emailAction] = useActionState<FormState, FormData>(sendEmailAction.bind(null, contactId), {});
  const [surveyState, setSurveyState] = useState<FormState>({});
  const [sendingSurvey, startSurvey] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const subject = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const state = channel === "email" ? emailState : noteState;

  useEffect(() => {
    if (noteState.message || emailState.message) form.current?.reset();
  }, [noteState, emailState]);

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (subject.current && t.subject) subject.current.value = t.subject;
    if (body.current) body.current.value = t.body;
    body.current?.focus();
  }

  return (
    <div className="flex flex-col gap-2.5 border-t px-4 py-3.5">
      <form ref={form} action={channel === "email" ? emailAction : noteAction} className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="channel" className="sr-only">
            Send via
          </label>
          <Select id="channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className="h-[34px] w-auto text-[13px] font-semibold">
            <option value="email" disabled={!contactEmail}>
              Email{contactEmail ? "" : " (no address)"}
            </option>
            <option value="note">Internal note</option>
          </Select>
          {templates.length > 0 && channel === "email" && (
            <>
              <label htmlFor="template" className="sr-only">
                Insert template
              </label>
              <Select id="template" defaultValue="" onChange={(e) => applyTemplate(e.target.value)} className="h-[34px] w-auto text-[13px]">
                <option value="" disabled>
                  Templates
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </>
          )}
          {projects.length > 1 && (
            <>
              <label htmlFor="project_id" className="sr-only">
                Project
              </label>
              <Select id="project_id" name="project_id" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-[34px] w-auto text-[13px]">
                <option value="">Not about one project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </>
          )}
          {projects.length === 1 && <input type="hidden" name="project_id" value={projects[0]!.id} />}
          {projects.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-[34px]"
              disabled={sendingSurvey || !contactEmail || !projectId}
              title={!contactEmail ? "Add an email address first" : !projectId ? "Choose a project" : undefined}
              onClick={() => startSurvey(async () => setSurveyState(await sendSurveyLinkAction(projectId)))}
            >
              <ClipboardList aria-hidden /> {sendingSurvey ? "Sending…" : "Send survey link"}
            </Button>
          )}
          <span className="ml-auto text-[12.5px] text-muted-foreground">
            {channel === "email" ? (emailLive ? `To ${contactEmail}` : "Email not connected yet: messages are recorded, not delivered") : "Only your team sees notes"}
          </span>
        </div>
        {channel === "email" && (
          <>
            <label htmlFor="subject" className="sr-only">
              Subject
            </label>
            <Input ref={subject} id="subject" name="subject" required placeholder="Subject" maxLength={200} />
          </>
        )}
        <div className="flex items-end gap-2.5">
          <label htmlFor="body" className="sr-only">
            {channel === "email" ? "Message" : "Note"}
          </label>
          <Textarea
            ref={body}
            id="body"
            name="body"
            required
            placeholder={channel === "email" ? "Write an email…" : "Write a note for the team…"}
            className="min-h-[72px] flex-1 rounded-[10px]"
          />
          <SubmitButton pendingText={channel === "email" ? "Sending…" : "Saving…"}>{channel === "email" ? "Send email" : "Add note"}</SubmitButton>
        </div>
      </form>
      <FormMessage state={surveyState.error || surveyState.message ? surveyState : state} />
    </div>
  );
}
