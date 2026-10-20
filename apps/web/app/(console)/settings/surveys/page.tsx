import { groupBySection, type Product } from "@goinstall/core";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PRODUCTS, productLabel } from "@/components/domain";
import {
  addQuestionAction,
  archiveTemplateAction,
  savePhotoCategoryAction,
  saveTemplateAction,
  setPhotoCategoryArchivedAction,
  setQuestionArchivedAction,
  updateQuestionAction,
} from "@/lib/actions/survey-settings";
import { asUser } from "@/lib/auth";

export const metadata = { title: "Surveys & templates" };

const TYPES = [
  { value: "text", label: "Short answer" },
  { value: "long_text", label: "Long answer" },
  { value: "number", label: "Number" },
  { value: "select", label: "Choice" },
  { value: "yes_no", label: "Yes / no" },
] as const;

function ProductBoxes({ prefix, selected }: { prefix: string; selected: readonly Product[] }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-[13px] font-semibold text-ink-2">Ask for</legend>
      <div className="flex flex-wrap gap-4">
        {PRODUCTS.map((p) => (
          <label key={p} htmlFor={`${prefix}-${p}`} className="flex items-center gap-2 text-sm">
            <input id={`${prefix}-${p}`} type="checkbox" name="products" value={p} defaultChecked={selected.includes(p)} className="size-4 accent-[var(--primary)]" />
            {productLabel(p)}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Leave all unticked to ask on every project.</p>
    </fieldset>
  );
}

function Check({ id, name, label, checked }: { id: string; name: string; label: string; checked: boolean }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" name={name} defaultChecked={checked} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  );
}

function LabelledInput({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<"input">) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <Input id={id} {...props} />
    </div>
  );
}

function QuestionFields({ prefix, q }: { prefix: string; q?: { label: string; help: string | null; section: string; type: string; options: string[]; products: Product[]; required: boolean; ask_online: boolean } }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <LabelledInput id={`${prefix}-label`} name="label" label="Question" defaultValue={q?.label} required />
        <LabelledInput id={`${prefix}-section`} name="section" label="Section" defaultValue={q?.section ?? "Your home"} required />
        <LabelledInput id={`${prefix}-help`} name="help" label="Help text (optional)" defaultValue={q?.help ?? ""} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefix}-type`} className="text-[13px] font-semibold text-ink-2">
            Answer type
          </label>
          <Select id={`${prefix}-type`} name="type" defaultValue={q?.type ?? "text"}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${prefix}-options`} className="text-[13px] font-semibold text-ink-2">
          Options for a choice question, one per line
        </label>
        <Textarea id={`${prefix}-options`} name="options" rows={3} defaultValue={q?.options.join("\n") ?? ""} />
      </div>
      <ProductBoxes prefix={`${prefix}-p`} selected={q?.products ?? []} />
      <div className="flex flex-wrap gap-5">
        <Check id={`${prefix}-required`} name="required" label="Required" checked={q?.required ?? false} />
        <Check id={`${prefix}-online`} name="ask_online" label="Ask the customer online (untick for team-only)" checked={q?.ask_online ?? true} />
      </div>
    </>
  );
}

export default async function SurveySettingsPage() {
  const { questions, categories, templates } = await asUser(
    (tx) =>
      Promise.all([
        tx.selectFrom("survey_questions").selectAll().orderBy("position").orderBy("key").execute(),
        tx.selectFrom("photo_categories").selectAll().orderBy("position").orderBy("key").execute(),
        tx.selectFrom("message_templates").selectAll().where("channel", "=", "email").where("archived_at", "is", null).orderBy("key").orderBy("name").execute(),
      ]).then(([questions, categories, templates]) => ({ questions, categories, templates })),
    ["admin"],
  );
  const active = questions.filter((q) => !q.archived_at);
  const archived = questions.filter((q) => q.archived_at);
  const groups = groupBySection(active.map((q) => ({ ...q, askOnline: q.ask_online })));

  return (
    <>
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Survey questions</CardTitle>
          <p className="text-sm text-ink-3">
            Each project&apos;s survey asks the questions for its products. Answers already given are kept if you change or archive a question.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.section} aria-labelledby={`sec-${g.section}`} className="flex flex-col gap-2">
              <h3 id={`sec-${g.section}`} className="text-xs font-bold tracking-[0.05em] text-muted-foreground uppercase">
                {g.section}
              </h3>
              <ul className="flex flex-col divide-y divide-divider rounded-[10px] border">
                {g.questions.map((q) => (
                  <li key={q.id}>
                    <details className="group">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
                        <span className="font-semibold">{q.label}</span>
                        {q.products.length ? q.products.map((p) => <Badge key={p} variant="tag">{productLabel(p)}</Badge>) : <Badge variant="tag">All projects</Badge>}
                        {q.required && <Badge variant="warning">Required</Badge>}
                        {!q.ask_online && <Badge variant="muted">Team only</Badge>}
                        <span className="ml-auto text-[13px] font-semibold text-primary group-open:hidden">Edit</span>
                      </summary>
                      <div className="flex flex-col gap-4 border-t border-divider px-4 py-4">
                        <ActionForm action={updateQuestionAction.bind(null, q.id)} className="flex flex-col gap-4">
                          <QuestionFields prefix={`q-${q.id}`} q={q} />
                          <div>
                            <SubmitButton size="sm">Save question</SubmitButton>
                          </div>
                        </ActionForm>
                        <form
                          action={async () => {
                            "use server";
                            await setQuestionArchivedAction(q.id, true);
                          }}
                        >
                          <Button type="submit" size="sm" variant="ghost" className="text-red-700">
                            Archive question
                          </Button>
                        </form>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <details className="rounded-[10px] border border-dashed border-input">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-primary">Add a question</summary>
            <ActionForm action={addQuestionAction} className="flex flex-col gap-4 border-t border-divider px-4 py-4" resetOnSuccess>
              <QuestionFields prefix="new-q" />
              <div>
                <SubmitButton size="sm">Add question</SubmitButton>
              </div>
            </ActionForm>
          </details>
          {archived.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-ink-3">Archived questions ({archived.length})</summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {archived.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-3">
                    <span className="text-ink-3">{q.label}</span>
                    <form
                      action={async () => {
                        "use server";
                        await setQuestionArchivedAction(q.id, false);
                      }}
                    >
                      <Button type="submit" size="sm" variant="outline">
                        Restore
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Required photos</CardTitle>
          <p className="text-sm text-ink-3">Shown to customers on the online survey and checked on the Survey tab.</p>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-divider rounded-[10px] border">
            {categories.map((c) => (
              <li key={c.id}>
                <details className="group">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
                    <span className={c.archived_at ? "text-muted-foreground line-through" : "font-semibold"}>{c.label}</span>
                    {c.products.length ? c.products.map((p) => <Badge key={p} variant="tag">{productLabel(p)}</Badge>) : <Badge variant="tag">All projects</Badge>}
                    {c.required && !c.archived_at && <Badge variant="warning">Required</Badge>}
                    <span className="ml-auto text-[13px] font-semibold text-primary group-open:hidden">Edit</span>
                  </summary>
                  <div className="flex flex-col gap-4 border-t border-divider px-4 py-4">
                    <ActionForm action={savePhotoCategoryAction.bind(null, c.id)} className="flex flex-col gap-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <LabelledInput id={`c-${c.id}-label`} name="label" label="Name" defaultValue={c.label} required />
                        <LabelledInput id={`c-${c.id}-help`} name="help" label="What to photograph" defaultValue={c.help ?? ""} />
                      </div>
                      <ProductBoxes prefix={`c-${c.id}-p`} selected={c.products} />
                      <Check id={`c-${c.id}-required`} name="required" label="Required" checked={c.required} />
                      <div>
                        <SubmitButton size="sm">Save photo type</SubmitButton>
                      </div>
                    </ActionForm>
                    <form
                      action={async () => {
                        "use server";
                        await setPhotoCategoryArchivedAction(c.id, !c.archived_at);
                      }}
                    >
                      <Button type="submit" size="sm" variant="ghost" className={c.archived_at ? undefined : "text-red-700"}>
                        {c.archived_at ? "Restore photo type" : "Archive photo type"}
                      </Button>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <details className="mt-4 rounded-[10px] border border-dashed border-input">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-primary">Add a photo type</summary>
            <ActionForm action={savePhotoCategoryAction.bind(null, null)} className="flex flex-col gap-4 border-t border-divider px-4 py-4" resetOnSuccess>
              <div className="grid gap-3 sm:grid-cols-2">
                <LabelledInput id="new-c-label" name="label" label="Name" required />
                <LabelledInput id="new-c-help" name="help" label="What to photograph" />
              </div>
              <ProductBoxes prefix="new-c-p" selected={[]} />
              <Check id="new-c-required" name="required" label="Required" checked />
              <div>
                <SubmitButton size="sm">Add photo type</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Email templates</CardTitle>
          <p className="text-sm text-ink-3">
            Placeholders: <code className="text-[13px]">{"{{first_name}} {{name}} {{company_name}} {{survey_link}} {{sender_name}} {{site_address}}"}</code>
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {templates.map((t) => (
            <details key={t.id} className="rounded-[10px] border">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="font-semibold">{t.name}</span>
                {t.key === "survey_link" && <Badge variant="muted">Sent by “Send survey link”</Badge>}
              </summary>
              <div className="flex flex-col gap-3 border-t border-divider px-4 py-4">
                <ActionForm action={saveTemplateAction.bind(null, t.id)} className="flex flex-col gap-3">
                  <LabelledInput id={`t-${t.id}-name`} name="name" label="Name" defaultValue={t.name} required />
                  <LabelledInput id={`t-${t.id}-subject`} name="subject" label="Subject" defaultValue={t.subject ?? ""} required />
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={`t-${t.id}-body`} className="text-[13px] font-semibold text-ink-2">
                      Message
                    </label>
                    <Textarea id={`t-${t.id}-body`} name="body" rows={9} defaultValue={t.body} required />
                  </div>
                  <div>
                    <SubmitButton size="sm">Save template</SubmitButton>
                  </div>
                </ActionForm>
                {!t.key && (
                  <form
                    action={async () => {
                      "use server";
                      await archiveTemplateAction(t.id);
                    }}
                  >
                    <Button type="submit" size="sm" variant="ghost" className="text-red-700">
                      Remove template
                    </Button>
                  </form>
                )}
              </div>
            </details>
          ))}
          <details className="rounded-[10px] border border-dashed border-input">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-primary">Add a template</summary>
            <ActionForm action={saveTemplateAction.bind(null, null)} className="flex flex-col gap-3 border-t border-divider px-4 py-4" resetOnSuccess>
              <LabelledInput id="new-t-name" name="name" label="Name" required placeholder="e.g. Survey reminder" />
              <LabelledInput id="new-t-subject" name="subject" label="Subject" required />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="new-t-body" className="text-[13px] font-semibold text-ink-2">
                  Message
                </label>
                <Textarea id="new-t-body" name="body" rows={6} required />
              </div>
              <div>
                <SubmitButton size="sm">Add template</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </CardContent>
      </Card>
    </>
  );
}
