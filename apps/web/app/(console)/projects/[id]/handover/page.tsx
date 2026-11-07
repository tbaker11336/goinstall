import { boardTitle, PAPERWORK_STATUS_LABELS, TIMING_LABELS, type PaperworkStatus, type PaperworkTiming, type TestValues } from "@goinstall/core";
import { Check, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/forms";
import { GenerateAllButton, GenerateItemButton, SendHandoverButton } from "@/components/paperwork-client";
import { TestBoardEditor } from "@/components/test-board-editor";
import { TestSchedule } from "@/components/test-schedule";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { uploadHandoverFilesAction } from "@/lib/actions/handover";
import { asUser } from "@/lib/auth";
import { signedUrls } from "@/lib/files";
import { syncPaperwork } from "@/lib/paperwork";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { RemoveHandoverFile } from "./handover-client";

export const metadata = { title: "Handover" };

export default async function HandoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const data = await asUser(async (tx, session) => {
    const project = await tx.selectFrom("projects").select(["id", "products"]).where("id", "=", id).executeTakeFirst();
    if (!project) return null;
    // Keep the paperwork list in step with the design and bookings.
    await syncPaperwork(tx, session.companyId, id);
    const [paperwork, items, signoff, uploads, boards] = await Promise.all([
      tx.selectFrom("paperwork_items").select(["id", "kind", "title", "timing", "status", "due_date", "due_note"]).where("project_id", "=", id).orderBy("kind").orderBy("title").execute(),
      tx
        .selectFrom("checklist_items as ci")
        .leftJoin("users as u", "u.id", "ci.completed_by")
        .leftJoin("checklist_templates as t", "t.id", "ci.template_id")
        .select(["ci.id", "ci.kind", "ci.product", "ci.title", "ci.done", "ci.serial", "ci.readings", "ci.photo_file_ids", "ci.note", "ci.captured_at", "u.full_name", "t.readings as reading_fields"])
        .where("ci.project_id", "=", id)
        .orderBy("ci.kind")
        .orderBy("ci.captured_at")
        .execute(),
      tx
        .selectFrom("bookings as b")
        .leftJoin("files as f", "f.id", "b.signoff_signature_file_id")
        .select(["b.signoff_name", "b.completed_at", "f.path"])
        .where("b.project_id", "=", id)
        .where("b.completed_at", "is not", null)
        .orderBy("b.completed_at", "desc")
        .executeTakeFirst(),
      tx.selectFrom("files").select(["id", "path", "content_type", "original_name", "created_at"]).where("project_id", "=", id).where("category", "=", "handover").where("deleted_at", "is", null).orderBy("created_at").execute(),
      tx
        .selectFrom("electrical_test_boards as t")
        .leftJoin("users as u", "u.id", "t.recorded_by")
        .select(["t.id", "t.board", "t.circuits", "t.captured_at", "u.full_name"])
        .where("t.project_id", "=", id)
        .orderBy("t.position")
        .orderBy("t.created_at")
        .execute(),
    ]);
    const photoIds = items.flatMap((i) => i.photo_file_ids);
    const photos = photoIds.length ? await tx.selectFrom("files").select(["id", "path"]).where("id", "in", photoIds).execute() : [];
    const pack = paperwork.find((p) => p.kind === "handover_pack");
    const packFile = pack
      ? await tx.selectFrom("files").select(["path", "created_at"]).where("paperwork_item_id", "=", pack.id).where("source", "=", "generated").where("deleted_at", "is", null).orderBy("created_at", "desc").executeTakeFirst()
      : undefined;
    return { project, paperwork, items, signoff, uploads, boards, photos, pack, packFile };
  });
  if (!data) notFound();
  const { paperwork, items, signoff, uploads, boards, photos, pack, packFile } = data;
  const others = paperwork.filter((p) => p.kind !== "handover_pack");
  const started = others.filter((p) => p.status !== "to_do").length;
  const urls = await signedUrls([...photos.map((p) => p.path), ...uploads.map((u) => u.path), ...(signoff?.path ? [signoff.path] : []), ...(packFile ? [packFile.path] : [])]);
  const photoUrl = (fid: string) => {
    const f = photos.find((p) => p.id === fid);
    return f ? urls.get(f.path) : null;
  };
  const photoCount = items.reduce((n, i) => n + i.photo_file_ids.length, 0) + uploads.filter((u) => u.content_type.startsWith("image/")).length;
  const packStatus = pack?.status as PaperworkStatus | undefined;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader className="flex-col items-start">
            <CardTitle>Electrical test results</CardTitle>
            <p className="text-sm text-ink-3">Each distribution board&apos;s details and its schedule of circuits and test results, filled in by the installer in the app (or typed in here from the sheet). They go into the handover pack and the electrician&apos;s certificate.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {boards.length === 0 && <p className="text-sm text-muted-foreground">No test results yet.</p>}
            {boards.map((b, i) => {
              const title = boardTitle(b.board as TestValues, i);
              return (
                <section key={b.id} aria-label={`Test results: ${title}`} className="flex flex-col gap-3 border-b pb-6 last:border-b-0 last:pb-0" data-testid="test-board">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-bold">{title}</h3>
                    <span className="text-xs text-ink-3">
                      {(b.circuits as TestValues[]).length} circuits · {b.full_name ?? "Recorded"} · {formatDateTime(b.captured_at)}
                    </span>
                  </div>
                  <TestSchedule title={title} board={b.board as TestValues} circuits={b.circuits as TestValues[]} />
                  <details>
                    <summary className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer list-none")}>Edit {title}</summary>
                    <div className="mt-3">
                      <TestBoardEditor projectId={id} boardId={b.id} initial={{ board: b.board as TestValues, circuits: b.circuits as TestValues[] }} />
                    </div>
                  </details>
                </section>
              );
            })}
            <details className="rounded-[10px] border border-dashed">
              <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-primary">
                <Plus className="size-4" aria-hidden /> Add a board
              </summary>
              <div className="border-t p-4">
                <TestBoardEditor projectId={id} boardId={null} initial={{ board: {}, circuits: [] }} />
              </div>
            </details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-col items-start">
            <CardTitle>From the installer</CardTitle>
            <p className="text-sm text-ink-3">Checklist steps, handover photos, readings, serial numbers and the customer&apos;s sign-off, as they sync from the app.</p>
          </CardHeader>
          <CardContent>
            {items.length === 0 && !signoff ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <ul className="divide-y" aria-label="Checklist results">
                {items.map((i) => {
                  const readings = Object.entries((i.readings ?? {}) as Record<string, string>).filter(([, v]) => v !== "");
                  return (
                    <li key={i.id} className="flex flex-col gap-1.5 py-3" data-testid="checklist-result">
                      <p className="flex items-center gap-2 font-semibold">
                        {i.done ? <Check className="size-4 text-success" aria-label="Done" /> : <span className="size-4 rounded-full border-2 border-warning" aria-label="Not done" />}
                        {i.title}
                        <span className="text-xs font-normal text-muted-foreground">
                          {i.kind === "handover" ? "Handover" : i.product} · {i.full_name ?? "Installer"} · {formatDateTime(i.captured_at)}
                        </span>
                      </p>
                      {i.serial && <p className="text-sm">Serial: {i.serial}</p>}
                      {readings.length > 0 && (
                        <p className="text-sm">
                          {readings
                            .map(([k, v]) => {
                              const f = ((i.reading_fields ?? []) as { key: string; label: string; unit: string | null }[]).find((r) => r.key === k);
                              return `${f?.label ?? k.replace(/_/g, " ")}: ${v}${f?.unit ? ` ${f.unit}` : ""}`;
                            })
                            .join(" · ")}
                        </p>
                      )}
                      {i.note && <p className="text-sm text-ink-3">{i.note}</p>}
                      {i.photo_file_ids.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {i.photo_file_ids.map((fid) => {
                            const u = photoUrl(fid);
                            return u ? (
                              <a key={fid} href={u} target="_blank" rel="noopener">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={u} alt={`Photo: ${i.title}`} className="size-28 rounded-md object-cover" />
                              </a>
                            ) : (
                              <span key={fid} className="text-xs text-muted-foreground">
                                Photo uploading…
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
                {signoff && (
                  <li className="flex flex-col gap-1.5 py-3">
                    <p className="font-semibold">
                      Signed off by {signoff.signoff_name} · {signoff.completed_at ? formatDateTime(signoff.completed_at) : ""}
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {signoff.path && urls.get(signoff.path) && <img src={urls.get(signoff.path)!} alt={`Signature of ${signoff.signoff_name}`} className="h-20 w-auto rounded-md border bg-white" />}
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-col items-start">
            <CardTitle>Your uploads</CardTitle>
            <p className="text-sm text-ink-3">Extra photos and documents for the pack: a manual, a warranty card, a photo of the finished job.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {uploads.length > 0 && (
              <ul className="flex flex-wrap gap-3" aria-label="Handover uploads">
                {uploads.map((u) => {
                  const url = urls.get(u.path);
                  const name = u.original_name ?? "File";
                  return (
                    <li key={u.id} className="flex w-40 flex-col gap-1 rounded-md border p-2 text-xs">
                      {u.content_type.startsWith("image/") && url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={name} className="h-28 w-full rounded object-cover" />
                      ) : (
                        <span className="grid h-28 place-items-center rounded bg-surface-subtle">
                          <FileText className="size-6 text-ink-3" aria-hidden />
                        </span>
                      )}
                      {url ? (
                        <a href={url} target="_blank" rel="noopener" className="truncate font-medium text-primary underline">
                          {name}
                        </a>
                      ) : (
                        <span className="truncate">{name}</span>
                      )}
                      <RemoveHandoverFile fileId={u.id} name={name} />
                    </li>
                  );
                })}
              </ul>
            )}
            <ActionForm action={uploadHandoverFilesAction.bind(null, id)} className="flex flex-wrap items-end gap-3" resetOnSuccess>
              <Field label="Add photos or PDFs" htmlFor="handover-files" hint="Up to 10 at a time, 10 MB each.">
                <Input id="handover-files" name="files" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" required className="w-80 py-1.5" aria-describedby="handover-files-hint" />
              </Field>
              <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex-col items-start">
            <div className="flex w-full items-baseline justify-between gap-2">
              <CardTitle>Handover pack</CardTitle>
              {packStatus && <Badge variant={packStatus === "done" ? "success" : "default"}>{packStatus === "done" ? "Sent" : PAPERWORK_STATUS_LABELS[packStatus]}</Badge>}
            </div>
            <p className="text-sm text-ink-3">One PDF for the customer to keep.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {pack ? (
              <>
                <ul className="flex flex-col gap-1 text-sm" aria-label="In the pack">
                  <li>Cover, your system and warranties</li>
                  <li>Electrical test results{boards.length ? ` (${boards.length} board${boards.length === 1 ? "" : "s"})` : ": none yet"}</li>
                  <li>Commissioning checks and readings{items.length ? "" : ": none yet"}</li>
                  <li>Photos{photoCount ? ` (${photoCount})` : ": none yet"}</li>
                  <li>System design and certificates</li>
                  <li>Product datasheets</li>
                  {uploads.some((u) => u.content_type === "application/pdf") && <li>Your PDFs ({uploads.filter((u) => u.content_type === "application/pdf").length})</li>}
                </ul>
                {packFile && urls.get(packFile.path) && (
                  <a href={urls.get(packFile.path)!} target="_blank" rel="noopener" className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>
                    <FileText className="size-4" aria-hidden /> Open the latest pack ({formatDate(packFile.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})
                  </a>
                )}
                <GenerateItemButton itemId={pack.id} label={packFile ? "Generate again" : "Generate pack"} />
                <SendHandoverButton projectId={id} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">The pack follows once the install is booked.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-col items-start">
            <div className="flex w-full items-baseline justify-between gap-2">
              <CardTitle>Paperwork</CardTitle>
              {others.length > 0 && (
                <span className="text-[13px] text-ink-3">
                  {started} of {others.length} started
                </span>
              )}
            </div>
            <p className="text-sm text-ink-3">DNO, MCS and the electrical certificate, pre-filled from the survey, design and install.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {others.length === 0 ? (
              <p className="text-sm text-muted-foreground">Items appear once the design is saved and the install is booked.</p>
            ) : (
              <ul className="divide-y" aria-label="Paperwork items">
                {others.map((p) => {
                  const status = p.status as PaperworkStatus;
                  const overdue = p.due_date && status === "to_do" && p.due_date.getTime() < Date.now() - 86_400_000;
                  return (
                    <li key={p.id}>
                      <Link href={`/projects/${id}/handover/paperwork/${p.id}`} className="flex items-center gap-3 py-3 hover:bg-surface-subtle">
                        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-surface-subtle">
                          <FileText className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">{p.title}</span>
                          <span className={cn("text-[13px]", overdue ? "font-semibold text-red-700" : "text-ink-3")}>
                            {p.due_date ? `Due ${formatDate(p.due_date, { day: "numeric", month: "short" })}` : TIMING_LABELS[p.timing as PaperworkTiming]}
                            {overdue && " · overdue"}
                          </span>
                        </span>
                        <Badge variant={status === "done" || status === "approved" ? "success" : status === "to_do" ? "default" : "warning"}>{PAPERWORK_STATUS_LABELS[status]}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {others.length > 0 && <GenerateAllButton projectId={id} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
