import { isSurveyKind, SOURCE_LABELS, SURVEY_KINDS, surveyKindsFor, surveyProgress, type FieldSource } from "@goinstall/core";
import Link from "next/link";
import { MapPin, Smartphone } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { saveSurveyFieldsAction, updateSiteVisitAction, uploadStaffPhotoAction } from "@/lib/actions/messaging";
import { asUser } from "@/lib/auth";
import { signedUrls } from "@/lib/files";
import { listStaff } from "@/lib/queries";
import { photoCounts, surveyConfig, surveyPhotos } from "@/lib/survey";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { MarkCompleteButton, RemovePhotoButton, SurveyLinkActions } from "./survey-controls";

export const metadata = { title: "Survey" };

const SOURCE_STYLES: Record<FieldSource | "missing", string> = {
  online: "text-info-text",
  photo: "text-violet-text",
  in_person: "text-success-text",
  staff_edit: "text-ink-3",
  missing: "text-warning-text",
};
const SOURCE_DOTS: Record<FieldSource | "missing", string> = {
  online: "bg-info",
  photo: "bg-violet",
  in_person: "bg-success",
  staff_edit: "bg-muted-foreground",
  missing: "bg-warning",
};

export default async function ProjectSurveyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string }> }) {
  const { id } = await params;
  const { kind: kindParam } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await asUser(async (tx) => {
    const project = await tx
      .selectFrom("projects as p")
      .innerJoin("contacts as c", "c.id", "p.contact_id")
      .select(["p.id", "p.stage", "p.products", "c.name as contact_name", "c.email as contact_email"])
      .where("p.id", "=", id)
      .executeTakeFirst();
    if (!project) return null;
    // EV chargers and solar & battery are separate surveys.
    const kinds = surveyKindsFor(project.products);
    const kind = isSurveyKind(kindParam) && kinds.includes(kindParam) ? kindParam : kinds[0]!;
    const [config, surveys, photos, staff] = await Promise.all([
      surveyConfig(tx, kind, project.products),
      tx.selectFrom("surveys").selectAll().where("project_id", "=", id).execute(),
      surveyPhotos(tx, id, undefined, kind),
      listStaff(tx),
    ]);
    const survey = surveys.find((s) => s.kind === kind);
    const fields = survey
      ? await tx
          .selectFrom("survey_fields as f")
          .leftJoin("users as u", "u.id", "f.edited_by")
          .select(["f.key", "f.value", "f.source", "u.full_name as editor"])
          .where("f.survey_id", "=", survey.id)
          .execute()
      : [];
    return { project, ...config, kinds, kind, surveys, survey, photos, staff, fields };
  });
  if (!data) notFound();
  const { project, questions, categories, kinds, kind, surveys, survey, photos, staff, fields } = data;

  const byKey = new Map(fields.map((f) => [f.key, f]));
  const counts = photoCounts(photos);
  const progress = surveyProgress(questions, fields, categories, counts);
  const urls = await signedUrls(photos.map((p) => p.path));
  const labels = new Map([...questions.map((q) => [q.key, q.label] as const), ...categories.map((c) => [c.key, c.label] as const)]);
  const missing = [...progress.missingRequired, ...progress.missingPhotos].map((k) => labels.get(k) ?? k);
  const status = survey?.online_status ?? "not_sent";
  const onlinePhotos = photos.filter((p) => p.source === "online_survey").length;
  const onlineAnswers = fields.filter((f) => f.source === "online").length;
  const canComplete = (project.stage === "enquiry" || project.stage === "survey") && !survey?.completed_at;
  // Photos in a category since archived still show.
  const otherPhotos = photos.filter((p) => !categories.some((c) => c.key === p.category));
  const visitAt = survey?.site_visit_at ? new Date(survey.site_visit_at).toISOString().slice(0, 16) : "";

  return (
    <div className="flex flex-col gap-6">
      {kinds.length > 1 && (
        <nav aria-label="Surveys" className="flex w-fit rounded-[9px] bg-divider p-[3px]">
          {kinds.map((k) => {
            const s = surveys.find((x) => x.kind === k);
            return (
              <Link
                key={k}
                href={`/projects/${project.id}/survey${k === kinds[0] ? "" : `?kind=${k}`}`}
                aria-current={k === kind ? "page" : undefined}
                className={cn("rounded-[7px] px-4 py-2 text-sm font-semibold text-ink-3 hover:text-foreground", k === kind && "bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.1)]")}
              >
                {SURVEY_KINDS[k].label}
                {s?.completed_at ? " ✓" : ""}
              </Link>
            );
          })}
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">
          <span className="font-semibold text-foreground">{SURVEY_KINDS[kind].label}</span>
          {survey?.completed_at ? ` · completed ${formatDate(survey.completed_at)}` : ""} ·{" "}
          {progress.answered} of {progress.total} answers · {progress.photosTaken} of {categories.length} photo types
          {missing.length > 0 && <span className="text-warning-text"> · missing {missing.length}</span>}
        </p>
        {canComplete && <MarkCompleteButton projectId={project.id} kind={kind} label={kinds.length > 1 ? `Mark ${SURVEY_KINDS[kind].short.toLowerCase()} survey complete` : undefined} missing={missing} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex gap-4 p-6 max-md:flex-col">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-success-tint text-success-text" aria-hidden>
            <Smartphone className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[17px] font-bold">Online {SURVEY_KINDS[kind].short.toLowerCase()} survey</h2>
              <OnlineStatusPill status={status} completedAt={survey?.online_completed_at ?? null} />
            </div>
            <p className="text-sm text-ink-3">
              {status === "not_sent" && `Send ${project.contact_name} a link to fill in on their phone.`}
              {status === "sent" && `Sent ${survey?.sent_at ? formatDate(survey.sent_at) : ""}${survey?.last_opened_at ? ` · opened ${formatDateTime(survey.last_opened_at)}` : " · not opened yet"}`}
              {status === "in_progress" && `${project.contact_name} has started: ${onlineAnswers} answers, ${onlinePhotos} photos so far.`}
              {status === "completed" && `Filled in by ${project.contact_name} · ${onlineAnswers} answers, ${onlinePhotos} photos.`}
            </p>
            <SurveyLinkActions key={kind} projectId={project.id} kind={kind} canEmail={Boolean(project.contact_email)} sent={status !== "not_sent"} />
          </div>
        </Card>

        <Card className="flex gap-4 p-6 max-md:flex-col">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-info-tint text-info-text" aria-hidden>
            <MapPin className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <h2 className="text-[17px] font-bold">Site visit</h2>
            <ActionForm action={updateSiteVisitAction.bind(null, project.id, kind)} className="flex flex-col gap-3">
              <div className="grid gap-2.5 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="site_visit_status" className="text-[13px] font-semibold text-ink-2">
                    Status
                  </label>
                  <Select id="site_visit_status" name="site_visit_status" defaultValue={survey?.site_visit_status ?? "not_needed"}>
                    <option value="not_needed">Not needed</option>
                    <option value="recommended">Recommended</option>
                    <option value="booked">Booked</option>
                    <option value="completed">Done</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="site_visit_at" className="text-[13px] font-semibold text-ink-2">
                    Date and time
                  </label>
                  <Input id="site_visit_at" name="site_visit_at" type="datetime-local" defaultValue={visitAt} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="surveyor_id" className="text-[13px] font-semibold text-ink-2">
                    Surveyor
                  </label>
                  <Select id="surveyor_id" name="surveyor_id" defaultValue={survey?.surveyor_id ?? ""}>
                    <option value="">Not assigned</option>
                    {staff.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton variant="outline">Save visit</SubmitButton>
                <span className="text-[13px] text-muted-foreground">Calendar booking and customer reminders arrive with scheduling.</span>
              </div>
            </ActionForm>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[17px] font-bold">Survey details</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold" aria-label="Where answers came from">
            {(["online", "photo", "in_person", "staff_edit", "missing"] as const).map((s) => (
              <li key={s} className={cn("inline-flex items-center gap-1.5", SOURCE_STYLES[s])}>
                <span className={cn("size-2 rounded-[2px]", SOURCE_DOTS[s])} aria-hidden />
                {s === "missing" ? "Missing" : SOURCE_LABELS[s]}
              </li>
            ))}
          </ul>
        </div>
        <ActionForm action={saveSurveyFieldsAction.bind(null, project.id, kind)} className="flex flex-col gap-5">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
            {questions.map((q) => {
              const f = byKey.get(q.key);
              const has = Boolean(f?.value?.trim());
              const tone: FieldSource | "missing" = has && f ? f.source : "missing";
              const sourceText = !has ? (q.required ? "Missing" : "Not answered") : f!.source === "staff_edit" ? `Edited by ${f!.editor ?? "team"}` : SOURCE_LABELS[f!.source];
              const id = `f_${q.key}`;
              return (
                <div key={q.key} className={cn("flex flex-col gap-1.5", q.type === "long_text" && "sm:col-span-2")}>
                  <label htmlFor={id} className="text-sm font-semibold text-ink-2">
                    {q.label}
                    {!q.askOnline && <span className="font-normal text-muted-foreground"> (team only)</span>}
                  </label>
                  {q.type === "select" || q.type === "yes_no" ? (
                    <Select id={id} name={id} defaultValue={f?.value ?? ""} aria-describedby={`${id}-src`} className={cn(!has && q.required && "border-warning-border bg-warning-tint")}>
                      <option value="">—</option>
                      {(q.type === "yes_no" ? ["Yes", "No"] : q.options).map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </Select>
                  ) : q.type === "long_text" ? (
                    <Textarea id={id} name={id} defaultValue={f?.value ?? ""} rows={2} aria-describedby={`${id}-src`} className={cn(!has && q.required && "border-warning-border bg-warning-tint")} />
                  ) : (
                    <Input
                      id={id}
                      name={id}
                      defaultValue={f?.value ?? ""}
                      inputMode={q.type === "number" ? "decimal" : undefined}
                      aria-describedby={`${id}-src`}
                      className={cn(!has && q.required && "border-warning-border bg-warning-tint")}
                    />
                  )}
                  <span id={`${id}-src`} className={cn("text-[13px] font-semibold", SOURCE_STYLES[tone], !has && !q.required && "font-medium text-muted-foreground")}>
                    {sourceText}
                  </span>
                </div>
              );
            })}
          </div>
          <div>
            <SubmitButton>Save answers</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card className="p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-bold">Photos</h2>
            <p className="text-sm text-ink-3">
              {progress.photosRequired - progress.missingPhotos.length} of {progress.photosRequired} required photos
            </p>
          </div>
          <ActionForm action={uploadStaffPhotoAction.bind(null, project.id, kind)} className="flex flex-wrap items-end gap-2" resetOnSuccess>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="photo-category" className="text-[13px] font-semibold text-ink-2">
                Photo of
              </label>
              <Select id="photo-category" name="category" required defaultValue="" className="w-auto">
                <option value="" disabled>
                  Choose…
                </option>
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="photo-file" className="text-[13px] font-semibold text-ink-2">
                File
              </label>
              <Input id="photo-file" name="photo" type="file" accept="image/*" required className="w-60 py-1.5" />
            </div>
            <SubmitButton variant="outline" pendingText="Uploading…">
              Upload photo
            </SubmitButton>
          </ActionForm>
        </div>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7">
          {categories.map((c) => {
            const items = photos.filter((p) => p.category === c.key);
            if (!items.length) {
              return (
                <li
                  key={c.key}
                  className={cn(
                    "flex aspect-[4/3] flex-col items-center justify-center rounded-[10px] border-2 border-dashed p-3 text-center text-sm font-semibold",
                    c.required ? "border-warning-border bg-warning-tint text-warning-text" : "border-input text-muted-foreground",
                  )}
                >
                  {c.required ? "Missing" : "Optional"}
                  <span className="font-semibold">{c.label}</span>
                </li>
              );
            }
            return items.map((p, i) => <PhotoTile key={p.id} projectId={project.id} id={p.id} url={urls.get(p.path) ?? null} label={c.label} caption={items.length > 1 ? `${c.label} ${i + 1}` : c.label} source={p.source} />);
          })}
          {otherPhotos.map((p) => (
            <PhotoTile key={p.id} projectId={project.id} id={p.id} url={urls.get(p.path) ?? null} label="Other" caption={p.category ?? "Other"} source={p.source} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function PhotoTile({ projectId, id, url, label, caption, source }: { projectId: string; id: string; url: string | null; label: string; caption: string; source: string }) {
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-[10px] border bg-surface-subtle">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs */}
          <img src={url} alt={caption} className="size-full object-cover" />
        </a>
      ) : (
        <span className="flex aspect-[4/3] items-center justify-center bg-muted text-xs text-muted-foreground">Unavailable</span>
      )}
      <span className="flex flex-col px-3 py-2">
        <span className="text-sm font-semibold">{caption}</span>
        <span className="text-xs text-muted-foreground">{source === "online_survey" ? "From customer" : "From team"}</span>
      </span>
      <RemovePhotoButton projectId={projectId} fileId={id} label={label} />
    </li>
  );
}

function OnlineStatusPill({ status, completedAt }: { status: "not_sent" | "sent" | "in_progress" | "completed"; completedAt: Date | null }) {
  const styles = {
    not_sent: "bg-muted text-ink-2",
    sent: "bg-info-tint text-info-text",
    in_progress: "bg-warning-pill text-warning-text",
    completed: "bg-success-tint text-success-text",
  };
  const text = {
    not_sent: "Not sent",
    sent: "Sent",
    in_progress: "In progress",
    completed: completedAt ? `Completed ${formatDate(completedAt)}` : "Completed",
  };
  return <span className={cn("rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold whitespace-nowrap", styles[status])}>{text[status]}</span>;
}
