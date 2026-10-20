import { MANUAL_FIELDS, missingValues, PAPERWORK_STATUS_LABELS, PAPERWORK_STATUSES, paperworkValues, TIMING_LABELS, type PaperworkKind, type PaperworkTiming } from "@goinstall/core";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, SubmitButton } from "@/components/forms";
import { GenerateItemButton, RemoveFileButton, SendHandoverButton } from "@/components/paperwork-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { savePaperworkItemAction, saveMpanAction, uploadPaperworkFileAction } from "@/lib/actions/paperwork";
import { asUser } from "@/lib/auth";
import { signedUrls } from "@/lib/files";
import { paperworkData, syncPaperwork } from "@/lib/paperwork";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Paperwork" };

const DNO: PaperworkKind[] = ["g98_notification", "g99_application", "ev_dno_notification"];
const UPLOAD_HINT: Record<PaperworkKind, string> = {
  g98_notification: "The DNO's acknowledgement, if they send one.",
  g99_application: "The DNO's offer or approval letter.",
  ev_dno_notification: "The DNO's acknowledgement, and the cut-out photo if the portal asks for one.",
  mcs_certificate: "The certificate issued by the MCS Installation Database.",
  eic: "The signed electrical installation certificate from the electrician's software.",
  warranty_registration: "The manufacturer's registration confirmation.",
  handover_pack: "Anything else to keep with the pack.",
};

export default async function PaperworkItemPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(itemId).success) notFound();
  const data = await asUser(async (tx, session) => {
    await syncPaperwork(tx, session.companyId, id);
    const item = await tx.selectFrom("paperwork_items").selectAll().where("id", "=", itemId).where("project_id", "=", id).executeTakeFirst();
    if (!item) return null;
    const [pw, files, product] = await Promise.all([
      paperworkData(tx, session.companyId, id),
      tx.selectFrom("files").select(["id", "path", "original_name", "source", "content_type", "created_at"]).where("paperwork_item_id", "=", itemId).where("deleted_at", "is", null).orderBy("created_at", "desc").execute(),
      item.product_id ? tx.selectFrom("products").select(["category"]).where("id", "=", item.product_id).executeTakeFirst() : null,
    ]);
    return { item, pw: pw!, files, product };
  });
  if (!data) notFound();
  const { item, pw, files, product } = data;
  const kind = item.kind as PaperworkKind;
  let ctx = pw.context;
  if (kind === "warranty_registration" && product) {
    const p = product.category === "ev_charger" ? "ev" : product.category === "battery" ? "battery" : "solar";
    ctx = { ...ctx, serials: ctx.serials.filter((x) => x.product === p) };
  }
  const manual = (item.fields ?? {}) as Record<string, string>;
  const values = paperworkValues(kind, ctx, manual).filter((v) => !v.manual);
  const gaps = missingValues(paperworkValues(kind, ctx, manual));
  const urls = await signedUrls(files.map((f) => f.path));
  const generated = files.filter((f) => f.source === "generated");
  const uploaded = files.filter((f) => f.source !== "generated");

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/projects/${id}/install`} className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-primary hover:text-accent-strong">
        <ArrowLeft className="size-4" aria-hidden /> Install &amp; paperwork
      </Link>
      <div>
        <h2 className="text-xl font-bold">{item.title}</h2>
        <p className="text-sm text-ink-3">
          {TIMING_LABELS[item.timing as PaperworkTiming]}
          {item.due_note ? ` · ${item.due_note}` : ""}
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          {DNO.includes(kind) && (
            <Card>
              <CardHeader className="flex-col items-start">
                <CardTitle>Supply</CardTitle>
                <p className="text-sm text-ink-3">The MPAN is on the customer&apos;s electricity bill. Every DNO form asks for it.</p>
              </CardHeader>
              <CardContent>
                <ActionForm action={saveMpanAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
                  <Field label="MPAN (13-digit core)" htmlFor="mpan" className="w-64">
                    <Input id="mpan" name="mpan" inputMode="numeric" defaultValue={ctx.site.mpan ?? ""} placeholder="e.g. 12 3456 7890 123" />
                  </Field>
                  <SubmitButton variant="outline">Save MPAN</SubmitButton>
                </ActionForm>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex-col items-start">
              <CardTitle>{kind === "handover_pack" ? "In the pack" : "Pre-filled values"}</CardTitle>
              <p className="text-sm text-ink-3">
                {DNO.includes(kind)
                  ? "For the ENA standard form or the DNO's portal. Gaps are what GoInstall doesn't know yet."
                  : kind === "mcs_certificate"
                    ? "For the MCS Installation Database, which issues the certificate."
                    : kind === "eic"
                      ? "Test readings from the installer app, for the electrician's certificate software."
                      : kind === "handover_pack"
                        ? "The design, single line diagram, uploaded certificates, datasheets and warranty details, merged into one PDF."
                        : "From the install."}
              </p>
            </CardHeader>
            <CardContent>
              <dl className="divide-y text-sm" aria-label="Pre-filled values">
                {values.map((v) => (
                  <div key={v.key} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_120px] sm:gap-3">
                    <dt className="text-ink-3">{v.label}</dt>
                    <dd className={cn("font-semibold", !v.value && "text-warning-text")}>{v.value ?? "Not known yet"}</dd>
                    <dd className="text-xs text-muted-foreground sm:text-right">{v.source}</dd>
                  </div>
                ))}
              </dl>
              {gaps.length > 0 && <p className="mt-3 rounded-md bg-warning-tint px-3 py-2 text-[13px] text-warning-text">Still to fill in: {gaps.join(", ")}.</p>}
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-6" aria-label="Item status">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionForm action={savePaperworkItemAction.bind(null, item.id)} className="flex flex-col gap-3">
                <Field label="Status" htmlFor="pw-status">
                  <Select id="pw-status" name="status" defaultValue={item.status}>
                    {PAPERWORK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {PAPERWORK_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Due date" htmlFor="pw-due" hint={item.due_auto && item.due_note ? `Set by the rules: ${item.due_note}` : undefined}>
                  <Input id="pw-due" name="due_date" type="date" defaultValue={item.due_date ? item.due_date.toISOString().slice(0, 10) : ""} />
                </Field>
                <Field label={kind === "mcs_certificate" ? "MCS certificate number" : DNO.includes(kind) ? "DNO reference" : "Reference"} htmlFor="pw-ref">
                  <Input id="pw-ref" name="reference" defaultValue={item.reference ?? ""} maxLength={120} />
                </Field>
                <Field label="Portal link" htmlFor="pw-url" hint="Where it was submitted (https://…)">
                  <Input id="pw-url" name="portal_url" type="url" defaultValue={item.portal_url ?? ""} placeholder="https://" />
                </Field>
                {(MANUAL_FIELDS[kind] ?? []).map((f) => (
                  <Field key={f.key} label={f.label} htmlFor={`pw-${f.key}`}>
                    <Input id={`pw-${f.key}`} name={`field_${f.key}`} defaultValue={manual[f.key] ?? ""} maxLength={300} />
                  </Field>
                ))}
                <Field label="Notes" htmlFor="pw-notes">
                  <Textarea id="pw-notes" name="notes" defaultValue={item.notes ?? ""} rows={3} maxLength={2000} />
                </Field>
                <SubmitButton>Save</SubmitButton>
              </ActionForm>
              {item.portal_url && (
                <a href={item.portal_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  Open the portal <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-col items-start">
              <CardTitle>{kind === "handover_pack" ? "Handover pack" : "Documents"}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <GenerateItemButton itemId={item.id} label={kind === "handover_pack" ? "Make the pack" : "Make details sheet (PDF)"} />
                {kind === "handover_pack" && <SendHandoverButton projectId={id} />}
              </div>
              {[["Made by GoInstall", generated], ["Uploaded", uploaded]].map(([label, list]) =>
                (list as typeof files).length ? (
                  <div key={label as string}>
                    <p className="mb-1 text-[13px] font-semibold text-ink-3">{label as string}</p>
                    <ul className="divide-y text-sm">
                      {(list as typeof files).map((f) => (
                        <li key={f.id} className="flex items-center gap-2 py-2">
                          {urls.get(f.path) ? (
                            <a href={urls.get(f.path)!} download={f.original_name ?? undefined} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold text-primary">
                              {f.original_name ?? "Document"}
                            </a>
                          ) : (
                            <span className="min-w-0 flex-1 truncate">{f.original_name ?? "Document"}</span>
                          )}
                          <span className="text-xs text-muted-foreground">{formatDateTime(f.created_at)}</span>
                          <RemoveFileButton fileId={f.id} name={f.original_name ?? "document"} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
              <ActionForm action={uploadPaperworkFileAction.bind(null, item.id)} resetOnSuccess className="flex flex-col gap-2 border-t pt-4">
                <Field label="Attach a document" htmlFor="pw-file" hint={UPLOAD_HINT[kind]}>
                  <Input id="pw-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" required />
                </Field>
                <SubmitButton variant="outline" pendingText="Uploading…">
                  Upload
                </SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
