"use client";

import { TEMPLATE_LIMITS, TEMPLATE_PAGE_LABELS, type ProposalTemplate, type TemplatePage } from "@goinstall/core";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { saveProposalTemplateAction, uploadTemplateImageAction } from "@/lib/actions/proposal-template";
import { cn } from "@/lib/utils";

/** Pick an image: uploaded straight away, shown as a preview, removable. */
function ImagePicker({ label, fileId, url, onChange, wide }: { label: string; fileId: string | null; url: string | null; onChange: (id: string | null, url: string | null) => void; wide?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <div className="flex items-center gap-3">
        <div className={cn("grid place-items-center overflow-hidden rounded-md border bg-surface-subtle", wide ? "h-24 w-40" : "h-16 w-16")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {fileId && url ? <img src={url} alt={`${label}: chosen image`} className={cn("h-full w-full", wide ? "object-cover" : "object-contain")} /> : <ImagePlus className="size-5 text-ink-3" aria-hidden />}
        </div>
        <div className="flex flex-col gap-1">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png"
            aria-label={label}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.set("image", f);
              start(async () => {
                const r = await uploadTemplateImageAction(fd);
                if (r.error) setError(r.error);
                else {
                  setError(null);
                  onChange(r.fileId!, r.url ?? null);
                }
                if (input.current) input.current.value = "";
              });
            }}
          />
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => input.current?.click()}>
            {pending ? "Uploading…" : fileId ? "Change image" : "Choose image"}
          </Button>
          {fileId && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null, null)}>
              Remove
            </Button>
          )}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      </div>
    </div>
  );
}

const blankPage = (n: number): TemplatePage => ({ id: `text-${Date.now().toString(36)}-${n}`, type: "text", enabled: true, title: "New page", intro: "", link: null, reviews: [], work: [], accreditations: [] });

/**
 * Settings › Proposal: the cover and the pages around the quote. Changes are
 * kept on screen until Save; images upload as soon as they're chosen.
 */
export function TemplateEditor({ initial, urls: initialUrls }: { initial: ProposalTemplate; urls: Record<string, string> }) {
  const [t, setT] = useState<ProposalTemplate>(initial);
  const [urls, setUrls] = useState<Record<string, string>>(initialUrls);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  const url = (id: string | null) => (id ? (urls[id] ?? null) : null);
  const remember = (id: string | null, u: string | null) => id && u && setUrls((m) => ({ ...m, [id]: u }));
  const setPage = (id: string, patch: Partial<TemplatePage>) => setT((x) => ({ ...x, pages: x.pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const move = (i: number, d: -1 | 1) =>
    setT((x) => {
      const j = i + d;
      if (j < 0 || j >= x.pages.length) return x;
      const pages = [...x.pages];
      [pages[i], pages[j]] = [pages[j]!, pages[i]!];
      return { ...x, pages };
    });

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="cover-h" className="flex flex-col gap-4 rounded-[14px] border bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="cover-h" className="text-base font-bold">
            Front cover
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={t.cover.enabled} onChange={(e) => setT((x) => ({ ...x, cover: { ...x.cover, enabled: e.target.checked } }))} className="size-4 accent-primary" />
            Show a front cover
          </label>
        </div>
        {t.cover.enabled && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cover-headline">Headline</Label>
                <Input id="cover-headline" value={t.cover.headline ?? ""} maxLength={TEMPLATE_LIMITS.short} placeholder="The proposal's title" onChange={(e) => setT((x) => ({ ...x, cover: { ...x.cover, headline: e.target.value || null } }))} aria-describedby="cover-headline-hint" />
                <p id="cover-headline-hint" className="text-xs text-ink-3">
                  Leave blank to use each proposal&apos;s title. {"{first_name}"}, {"{name}"} and {"{address}"} are filled in, e.g. “Your solar proposal, {"{first_name}"}”.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cover-sub">Subheading (optional)</Label>
                <Input id="cover-sub" value={t.cover.subheading ?? ""} maxLength={300} placeholder="e.g. Clean energy for your home, fitted by local engineers" onChange={(e) => setT((x) => ({ ...x, cover: { ...x.cover, subheading: e.target.value || null } }))} />
              </div>
            </div>
            <ImagePicker
              label="Cover photo"
              wide
              fileId={t.cover.imageFileId}
              url={url(t.cover.imageFileId)}
              onChange={(id, u) => {
                remember(id, u);
                setT((x) => ({ ...x, cover: { ...x.cover, imageFileId: id } }));
              }}
            />
          </div>
        )}
      </section>

      <section aria-labelledby="pages-h" className="flex flex-col gap-3 rounded-[14px] border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="pages-h" className="text-base font-bold">
              Pages
            </h2>
            <p className="text-sm text-ink-3">In the order the customer reads them. Pages with nothing on them are left out.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={t.pages.length >= TEMPLATE_LIMITS.pages}
            onClick={() => {
              const pg = blankPage(t.pages.length);
              setT((x) => ({ ...x, pages: [...x.pages, pg] }));
              setOpen(pg.id);
            }}
          >
            <Plus className="size-4" aria-hidden /> Add a custom page
          </Button>
        </div>
        <ol className="flex flex-col gap-2" aria-label="Proposal pages">
          {t.pages.map((p, i) => {
            const name = p.type === "quote" ? "Your quote" : (p.title ?? TEMPLATE_PAGE_LABELS[p.type]);
            const isOpen = open === p.id;
            return (
              <li key={p.id} className={cn("rounded-[10px] border", isOpen && "border-primary")} data-testid="template-page">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="w-6 text-sm text-ink-3">{i + 1}.</span>
                  {p.type === "quote" ? (
                    <span className="flex-1 font-semibold">
                      Your quote <span className="text-xs font-normal text-ink-3">(the price, system and savings: always included)</span>
                    </span>
                  ) : (
                    <button type="button" className="flex-1 text-left font-semibold hover:text-primary" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
                      {name}
                      <span className="ml-2 text-xs font-normal text-ink-3">{p.type === "text" ? "Custom page" : TEMPLATE_PAGE_LABELS[p.type] !== name ? TEMPLATE_PAGE_LABELS[p.type] : ""}</span>
                    </button>
                  )}
                  {p.type !== "quote" && (
                    <label className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={p.enabled} onChange={(e) => setPage(p.id, { enabled: e.target.checked })} className="size-4 accent-primary" aria-label={`Show ${name}`} />
                      Show
                    </label>
                  )}
                  <Button type="button" size="icon" variant="ghost" aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={`Move ${name} down`} disabled={i === t.pages.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" />
                  </Button>
                  {p.type === "text" && (
                    <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${name}`} onClick={() => setT((x) => ({ ...x, pages: x.pages.filter((q) => q.id !== p.id) }))}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                {isOpen && p.type !== "quote" && (
                  <div className="flex flex-col gap-4 border-t px-4 py-4">
                    <div className="grid gap-1.5 sm:max-w-md">
                      <Label htmlFor={`${p.id}-title`}>Heading</Label>
                      <Input id={`${p.id}-title`} value={p.title ?? ""} placeholder={TEMPLATE_PAGE_LABELS[p.type]} maxLength={TEMPLATE_LIMITS.short} onChange={(e) => setPage(p.id, { title: e.target.value || null })} />
                    </div>
                    {p.type === "about" && (
                      <p className="text-sm text-ink-3">
                        The text, your logo and accreditation numbers come from{" "}
                        <Link href="/settings/company" className="font-semibold text-primary underline">
                          Company details
                        </Link>
                        .
                      </p>
                    )}
                    {p.type === "text" && (
                      <div className="grid gap-1.5">
                        <Label htmlFor={`${p.id}-body`}>Text</Label>
                        <Textarea id={`${p.id}-body`} rows={6} maxLength={TEMPLATE_LIMITS.text} value={p.intro ?? ""} onChange={(e) => setPage(p.id, { intro: e.target.value })} placeholder="e.g. Our workmanship guarantee, how the install day works, aftercare." />
                      </div>
                    )}
                    {p.type === "reviews" && <ReviewsEditor page={p} set={(patch) => setPage(p.id, patch)} />}
                    {p.type === "featured_work" && (
                      <ItemsEditor
                        label="project"
                        items={p.work}
                        max={TEMPLATE_LIMITS.work}
                        onAdd={() => setPage(p.id, { work: [...p.work, { title: "", description: null, photoFileId: null }] })}
                        onRemove={(k) => setPage(p.id, { work: p.work.filter((_, j) => j !== k) })}
                        render={(w, k) => (
                          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                            <ImagePicker label={`Project ${k + 1} photo`} wide fileId={w.photoFileId} url={url(w.photoFileId)} onChange={(id, u) => { remember(id, u); setPage(p.id, { work: p.work.map((x, j) => (j === k ? { ...x, photoFileId: id } : x)) }); }} />
                            <div className="flex flex-col gap-2">
                              <Input aria-label={`Project ${k + 1} title`} placeholder="e.g. 16-panel install, Clifton" value={w.title} maxLength={TEMPLATE_LIMITS.short} onChange={(e) => setPage(p.id, { work: p.work.map((x, j) => (j === k ? { ...x, title: e.target.value } : x)) })} />
                              <Textarea aria-label={`Project ${k + 1} description`} rows={2} maxLength={500} placeholder="A line about the job (optional)" value={w.description ?? ""} onChange={(e) => setPage(p.id, { work: p.work.map((x, j) => (j === k ? { ...x, description: e.target.value || null } : x)) })} />
                            </div>
                          </div>
                        )}
                      />
                    )}
                    {p.type === "accreditations" && (
                      <ItemsEditor
                        label="accreditation"
                        items={p.accreditations}
                        max={TEMPLATE_LIMITS.accreditations}
                        onAdd={() => setPage(p.id, { accreditations: [...p.accreditations, { name: "", number: null, logoFileId: null }] })}
                        onRemove={(k) => setPage(p.id, { accreditations: p.accreditations.filter((_, j) => j !== k) })}
                        render={(a, k) => (
                          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
                            <ImagePicker label={`Accreditation ${k + 1} logo`} fileId={a.logoFileId} url={url(a.logoFileId)} onChange={(id, u) => { remember(id, u); setPage(p.id, { accreditations: p.accreditations.map((x, j) => (j === k ? { ...x, logoFileId: id } : x)) }); }} />
                            <Input aria-label={`Accreditation ${k + 1} name`} placeholder="e.g. MCS, NICEIC, TrustMark" value={a.name} maxLength={TEMPLATE_LIMITS.short} onChange={(e) => setPage(p.id, { accreditations: p.accreditations.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} />
                            <Input aria-label={`Accreditation ${k + 1} number`} placeholder="Membership number (optional)" value={a.number ?? ""} maxLength={60} onChange={(e) => setPage(p.id, { accreditations: p.accreditations.map((x, j) => (j === k ? { ...x, number: e.target.value || null } : x)) })} />
                          </div>
                        )}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={pending} onClick={() => start(async () => setState(await saveProposalTemplateAction(t)))}>
          {pending ? "Saving…" : "Save proposal template"}
        </Button>
        <Link href="/settings/proposal/preview" target="_blank" className={buttonVariants({ variant: "outline" })}>
          Preview (saved version)
        </Link>
      </div>
      <FormMessage state={state} />
    </div>
  );
}

function ItemsEditor<T>({ label, items, max, onAdd, onRemove, render }: { label: string; items: T[]; max: number; onAdd: () => void; onRemove: (i: number) => void; render: (item: T, i: number) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && <p className="text-sm text-ink-3">None yet.</p>}
      {items.map((it, i) => (
        <div key={i} className="relative rounded-md border p-3 pr-10">
          {render(it, i)}
          <Button type="button" size="icon" variant="ghost" className="absolute top-1 right-1" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onRemove(i)}>
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" size="sm" variant="outline" disabled={items.length >= max} onClick={onAdd}>
          <Plus className="size-4" aria-hidden /> Add {label}
        </Button>
      </div>
    </div>
  );
}

function ReviewsEditor({ page, set }: { page: TemplatePage; set: (patch: Partial<TemplatePage>) => void }) {
  const upd = (k: number, patch: Partial<TemplatePage["reviews"][number]>) => set({ reviews: page.reviews.map((r, j) => (j === k ? { ...r, ...patch } : r)) });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${page.id}-intro`}>Line under the heading (optional)</Label>
          <Input id={`${page.id}-intro`} value={page.intro ?? ""} maxLength={300} placeholder="e.g. Rated 4.9 on Google" onChange={(e) => set({ intro: e.target.value || null })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${page.id}-link`}>Link to all your reviews (optional)</Label>
          <Input id={`${page.id}-link`} type="url" value={page.link ?? ""} maxLength={500} placeholder="https://…" onChange={(e) => set({ link: e.target.value || null })} />
        </div>
      </div>
      <ItemsEditor
        label="review"
        items={page.reviews}
        max={TEMPLATE_LIMITS.reviews}
        onAdd={() => set({ reviews: [...page.reviews, { name: "", location: null, rating: 5, text: "" }] })}
        onRemove={(k) => set({ reviews: page.reviews.filter((_, j) => j !== k) })}
        render={(r, k) => (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input aria-label={`Review ${k + 1} name`} placeholder="Customer name" value={r.name} maxLength={TEMPLATE_LIMITS.short} onChange={(e) => upd(k, { name: e.target.value })} />
            <Input aria-label={`Review ${k + 1} location`} placeholder="Town (optional)" value={r.location ?? ""} maxLength={TEMPLATE_LIMITS.short} onChange={(e) => upd(k, { location: e.target.value || null })} />
            <Select aria-label={`Review ${k + 1} stars`} value={r.rating ?? ""} onChange={(e) => upd(k, { rating: e.target.value ? Number(e.target.value) : null })} className="w-auto">
              <option value="">No stars</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} star{n === 1 ? "" : "s"}
                </option>
              ))}
            </Select>
            <Textarea aria-label={`Review ${k + 1} text`} className="sm:col-span-3" rows={2} maxLength={1000} placeholder="What they said" value={r.text} onChange={(e) => upd(k, { text: e.target.value })} />
          </div>
        )}
      />
    </div>
  );
}
