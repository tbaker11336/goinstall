import { formatReadings, type ReadingField } from "@goinstall/core";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { archiveChecklistStepAction, saveChecklistStepAction } from "@/lib/actions/checklist-settings";
import { asUser } from "@/lib/auth";

export const metadata = { title: "Install checklists" };

const PRODUCT = { general: "Every job", solar: "Solar PV", battery: "Battery", ev: "EV charger" } as const;

type Step = { id: string; kind: string; product: string; title: string; help: string | null; position: number; requires_photo: boolean; requires_serial: boolean; readings: unknown; is_draft: boolean };

function StepForm({ step, kind, nextPosition }: { step?: Step; kind: "install" | "handover"; nextPosition: number }) {
  const p = step ? `s-${step.id}` : `new-${kind}`;
  return (
    <ActionForm action={saveChecklistStepAction.bind(null, step?.id ?? null)} className="grid gap-3 sm:grid-cols-[1fr_160px_90px]">
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-1.5">
        <Label htmlFor={`${p}-title`}>Step</Label>
        <Input id={`${p}-title`} name="title" defaultValue={step?.title ?? ""} required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${p}-product`}>Applies to</Label>
        <Select id={`${p}-product`} name="product" defaultValue={step?.product ?? "general"}>
          {Object.entries(PRODUCT).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${p}-pos`}>Order</Label>
        <Input id={`${p}-pos`} name="position" type="number" min={0} defaultValue={step?.position ?? nextPosition} />
      </div>
      <div className="grid gap-1.5 sm:col-span-3">
        <Label htmlFor={`${p}-help`}>Guidance for the installer (optional)</Label>
        <Input id={`${p}-help`} name="help" defaultValue={step?.help ?? ""} />
      </div>
      {kind === "install" && (
        <>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`${p}-readings`}>Test readings to record, one per line with the unit in brackets</Label>
            <Textarea id={`${p}-readings`} name="readings" rows={2} defaultValue={formatReadings((step?.readings ?? []) as ReadingField[])} placeholder="Insulation resistance (MΩ)" />
          </div>
          <fieldset className="flex flex-col justify-end gap-1.5 text-sm">
            <legend className="sr-only">Evidence</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requires_photo" defaultChecked={step?.requires_photo ?? true} className="accent-[var(--primary)]" /> Photo needed
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requires_serial" defaultChecked={step?.requires_serial ?? false} className="accent-[var(--primary)]" /> Serial number
            </label>
          </fieldset>
        </>
      )}
      {kind === "handover" && <input type="hidden" name="readings" value="" />}
      <div className="flex items-center gap-2 sm:col-span-3">
        <SubmitButton size="sm" variant="outline">
          {step ? (step.is_draft ? "Approve and save" : "Save") : "Add step"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export default async function ChecklistSettingsPage() {
  const steps = await asUser((tx) => tx.selectFrom("checklist_templates").selectAll().where("archived_at", "is", null).orderBy("kind").orderBy("position").execute(), ["admin"]);
  const drafts = steps.filter((s) => s.is_draft).length;
  return (
    <>
      {drafts > 0 && (
        <p role="status" className="rounded-[10px] border border-warning-border bg-warning-tint px-4 py-3 text-sm text-warning-text">
          {drafts} step{drafts === 1 ? " is a" : "s are"} GoInstall starter draft{drafts === 1 ? "" : "s"}. Check each against how your team works and approve or change it. Readings have no
          pass or fail values: installers record what they measure.
        </p>
      )}
      {(["install", "handover"] as const).map((kind) => {
        const mine = steps.filter((s) => s.kind === kind);
        return (
          <Card key={kind}>
            <CardHeader className="flex-col items-start">
              <CardTitle>{kind === "install" ? "Install checklist" : "Customer handover"}</CardTitle>
              <p className="text-sm text-ink-3">
                {kind === "install" ? "Steps in the installer app, grouped by product. Each can need a photo, a serial number and test readings." : "Ticked off with the customer before they sign."}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {mine.map((s) => (
                <section key={s.id} aria-label={s.title} className="flex flex-col gap-2 rounded-[10px] border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold">
                      {s.title} <span className="font-normal text-muted-foreground">· {PRODUCT[s.product as keyof typeof PRODUCT]}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {s.is_draft && <Badge variant="warning">Draft</Badge>}
                      <form action={archiveChecklistStepAction.bind(null, s.id) as unknown as (f: FormData) => void}>
                        <Button type="submit" size="sm" variant="ghost">
                          Remove
                        </Button>
                      </form>
                    </div>
                  </div>
                  <StepForm step={s} kind={kind} nextPosition={0} />
                </section>
              ))}
              <section aria-label={`Add a ${kind} step`} className="rounded-[10px] border border-dashed p-4">
                <h3 className="mb-2 text-sm font-bold">Add a step</h3>
                <StepForm kind={kind} nextPosition={(mine.at(-1)?.position ?? 0) + 10} />
              </section>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
