import { formatLength, formatPence, PROJECT_STAGE_INFO, stageIndex, stageLabel, type ActiveProjectStage, type LengthUnit } from "@goinstall/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCheckboxes } from "@/components/contact-fields";
import { ActionForm, SubmitButton } from "@/components/forms";
import { StageControls } from "@/components/stage-controls";
import { Thread } from "@/components/thread";
import { Avatar } from "@/components/domain";
import { DeleteRecord } from "@/components/delete-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { addNoteAction, updateProjectAction, updateWorkDescriptionAction } from "@/lib/actions/crm";
import { asUser } from "@/lib/auth";
import { projectProfit } from "@/lib/profit";
import { contactTimeline, listStaff } from "@/lib/queries";
import { cn, formatDate, formatMoney } from "@/lib/utils";

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await asUser(async (tx, session) => {
    const project = await tx
      .selectFrom("projects as p")
      .innerJoin("contacts as c", "c.id", "p.contact_id")
      .select([
        "p.id",
        "p.stage",
        "p.lost_from_stage",
        "p.lost_reason",
        "p.products",
        "p.work_description",
        "p.estimated_length",
        "p.estimated_length_unit",
        "p.value",
        "p.owner_id",
        "p.target_install_month",
        "p.stage_changed_at",
        "p.created_at",
        "p.site_address_line1",
        "p.site_address_line2",
        "p.site_town",
        "p.site_county",
        "p.site_postcode",
        "c.id as contact_id",
        "c.name as contact_name",
        "c.phone as contact_phone",
        "c.email as contact_email",
      ])
      .where("p.id", "=", id)
      .executeTakeFirst();
    if (!project) return null;
    const [timeline, staff] = await Promise.all([contactTimeline(tx, project.contact_id, project.id), listStaff(tx)]);
    return { project, timeline, staff, isAdmin: session.role === "admin", profit: await projectProfit(tx, project.id) };
  });
  if (!data) notFound();
  const { project: p, timeline, staff } = data;

  const reached: ActiveProjectStage = p.stage !== "lost" ? p.stage : p.lost_from_stage && p.lost_from_stage !== "lost" ? p.lost_from_stage : "enquiry";
  const info = p.stage === "lost" ? null : PROJECT_STAGE_INFO[p.stage];
  const month = p.target_install_month ? new Date(p.target_install_month).toISOString().slice(0, 7) : "";

  // Progress bar groups the nine stages into the seven steps the design shows.
  const steps: { label: string; from: ActiveProjectStage; to: ActiveProjectStage }[] = [
    { label: "Enquiry", from: "enquiry", to: "enquiry" },
    { label: "Survey", from: "survey", to: "survey" },
    { label: "Design", from: "design", to: "design" },
    { label: "Proposal", from: "proposal_sent", to: "deposit_paid" },
    { label: "Kit", from: "kit_ordered", to: "kit_ordered" },
    { label: "Install", from: "scheduled", to: "scheduled" },
    { label: "Paperwork", from: "complete", to: "complete" },
  ];
  const at = stageIndex(reached);
  const currentStep = steps.findIndex((st) => at >= stageIndex(st.from) && at <= stageIndex(st.to));
  const owner = staff.find((u) => u.id === p.owner_id)?.full_name;
  const targetMonth = p.target_install_month
    ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(p.target_install_month))
    : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <span className="text-[13px] text-muted-foreground">
            {p.stage === "lost" ? "Lost" : `Step ${currentStep + 1} of ${steps.length}`}
            {targetMonth && ` · target install ${targetMonth}`}
          </span>
        </CardHeader>
        <CardContent>
          <ol className="grid grid-cols-7 gap-3 max-md:grid-cols-4">
            {steps.map((st, i) => {
              const done = i < currentStep || (p.stage === "complete" && i === currentStep);
              const current = i === currentStep && !done && p.stage !== "lost";
              return (
                <li key={st.label} className="flex flex-col gap-2" aria-current={current ? "step" : undefined}>
                  <span className="h-1 overflow-hidden rounded-full bg-divider">
                    <span className={cn("block h-full bg-primary", done ? "w-full" : current ? "w-1/2" : "w-0")} />
                  </span>
                  <span className={cn("text-[13px] font-semibold", done ? "text-primary" : current ? "text-foreground" : "text-muted-foreground")}>
                    {st.label}
                    {done && <span className="sr-only"> (done)</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_minmax(20rem,26rem)]">
        <div className="flex flex-col gap-6">
          <section aria-labelledby="next-step" className="grid gap-5 rounded-lg bg-accent-deep p-8 text-white md:grid-cols-[1fr_18rem] max-md:p-5">
            <div className="flex flex-col gap-2">
              <h2 id="next-step" className="text-xs font-bold tracking-[0.05em] text-[#9fd8c6] uppercase">
                Next step
              </h2>
              {p.stage === "lost" ? (
                <>
                  <p className="text-xl font-bold">This project was lost{p.lost_from_stage ? ` at ${stageLabel(p.lost_from_stage)}` : ""}.</p>
                  <p className="text-sm text-white/80">Reason: {p.lost_reason}</p>
                </>
              ) : (
                <>
                  <p className="text-xl leading-snug font-bold">{info?.nextAction ?? "Job complete"}</p>
                  <p className="text-sm text-white/80">
                    In {stageLabel(p.stage)} since {formatDate(p.stage_changed_at)}. Tools for this step arrive in later phases; move the stage when it&apos;s done.
                  </p>
                </>
              )}
            </div>
            <div className="rounded-lg bg-card p-4 text-foreground">
              <StageControls projectId={p.id} stage={p.stage} lostFromStage={p.lost_from_stage} />
            </div>
          </section>

          <Card>
            <CardHeader className="flex-col items-start">
              <CardTitle>Work description</CardTitle>
              <p className="text-sm text-ink-3">What the job is, in your own words. Installers see it in the app.</p>
            </CardHeader>
            <CardContent>
              <ActionForm action={updateWorkDescriptionAction.bind(null, p.id)} className="flex flex-col gap-3">
                <label htmlFor="work_description" className="sr-only">
                  Work description
                </label>
                <Textarea id="work_description" name="work_description" rows={4} maxLength={5000} defaultValue={p.work_description ?? ""} placeholder="e.g. Replace consumer unit with a 10-way RCBO board and surge protection; add two double sockets in the kitchen." />
                <div>
                  <SubmitButton size="sm" variant="outline" pendingText="Saving…">
                    Save description
                  </SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <Thread messages={timeline.messages} events={timeline.events} tab="all" variant="feed" />
            <ActionForm action={addNoteAction.bind(null, p.contact_id)} className="flex items-end gap-2.5 px-5 pt-2 pb-5" resetOnSuccess>
              <input type="hidden" name="project_id" value={p.id} />
              <label htmlFor="body" className="sr-only">
                Note
              </label>
              <Textarea id="body" name="body" required rows={1} placeholder="Add a note for the team…" className="min-h-10 flex-1 resize-y" />
              <SubmitButton variant="outline">Add note</SubmitButton>
            </ActionForm>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col">
              <div className="flex items-center gap-3 pb-3">
                <Avatar name={p.contact_name} size="lg" className="size-12 text-sm" />
                <div className="flex min-w-0 flex-col">
                  <Link href={`/contacts/${p.contact_id}`} className="font-semibold text-primary hover:text-accent-strong">
                    {p.contact_name}
                  </Link>
                  {p.contact_phone && (
                    <a href={`tel:${p.contact_phone}`} className="text-sm text-ink-3 hover:text-foreground">
                      {p.contact_phone}
                    </a>
                  )}
                </div>
              </div>
              {p.contact_email && <DetailRow label="Email" value={<a href={`mailto:${p.contact_email}`} className="break-all hover:underline">{p.contact_email}</a>} />}
              <DetailRow label="Created" value={formatDate(p.created_at)} last />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Key details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col">
              <DetailRow label="Estimated value" value={p.value != null ? <strong>{formatMoney(p.value)}</strong> : "Not set"} />
              <DetailRow label="Owner" value={owner ?? "Unassigned"} />
              <DetailRow label="Project length" value={p.estimated_length && p.estimated_length_unit ? formatLength(Number(p.estimated_length), p.estimated_length_unit as LengthUnit) : "Not set"} />
              <DetailRow label="Target install" value={targetMonth ?? "Not set"} last={!data.profit} />
              {data.profit && (
                <DetailRow
                  label={data.profit.accepted ? "Profit (accepted quote)" : "Profit (latest quote)"}
                  value={
                    <strong className={data.profit.profit.profitPence < 0 ? "text-red-700" : "text-success-text"} data-testid="overview-profit">
                      {formatPence(data.profit.profit.profitPence)}
                      {data.profit.profit.margin !== null ? ` · ${(data.profit.profit.margin * 100).toFixed(0)}%` : ""}
                    </strong>
                  }
                  last
                />
              )}
              <details className="group mt-2">
                <summary className="cursor-pointer text-sm font-semibold text-primary hover:text-accent-strong">Edit details</summary>
            <ActionForm action={updateProjectAction.bind(null, p.id)} className="mt-4 grid gap-4">
              <Field label="Value (£)" htmlFor="value">
                <Input id="value" name="value" inputMode="decimal" defaultValue={p.value ?? ""} />
              </Field>
              <Field label="Owner" htmlFor="owner_id">
                <Select id="owner_id" name="owner_id" defaultValue={p.owner_id ?? ""}>
                  <option value="">Unassigned</option>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Project length" htmlFor="estimated_length" hint="How long the job takes, e.g. 2 hours, 2 days or 6 weeks. Used when booking it.">
                <div className="flex gap-2">
                  <Input id="estimated_length" name="estimated_length" type="number" inputMode="decimal" min={0.25} step={0.25} defaultValue={p.estimated_length ?? ""} className="w-24" aria-describedby="estimated_length-hint" />
                  <label htmlFor="estimated_length_unit" className="sr-only">
                    Project length in
                  </label>
                  <Select id="estimated_length_unit" name="estimated_length_unit" defaultValue={p.estimated_length_unit ?? "days"} className="w-auto">
                    <option value="hours">Hours</option>
                    <option value="days">Working days</option>
                    <option value="weeks">Working weeks</option>
                  </Select>
                </div>
              </Field>
              <Field label="Target install month" htmlFor="target_install_month">
                <Input id="target_install_month" name="target_install_month" type="month" defaultValue={month} />
              </Field>
              <ProductCheckboxes legend="Products" selected={p.products} />
              <fieldset className="grid gap-2">
                <legend className="mb-1.5 text-sm font-medium">Site address</legend>
                <Input aria-label="Site address line 1" name="site_address_line1" defaultValue={p.site_address_line1 ?? ""} />
                <Input aria-label="Site address line 2" name="site_address_line2" defaultValue={p.site_address_line2 ?? ""} />
                <div className="grid grid-cols-2 gap-2">
                  <Input aria-label="Site town" name="site_town" placeholder="Town" defaultValue={p.site_town ?? ""} />
                  <Input aria-label="Site postcode" name="site_postcode" placeholder="Postcode" defaultValue={p.site_postcode ?? ""} />
                </div>
                <input type="hidden" name="site_county" value={p.site_county ?? ""} />
              </fieldset>
              <div>
                <SubmitButton size="sm">Save details</SubmitButton>
              </div>
            </ActionForm>
              </details>
            </CardContent>
          </Card>
          {data.isAdmin && (
            <DeleteRecord
              kind="project"
              id={p.id}
              name={`the project at ${p.site_address_line1 ?? "this address"}`}
              consequences="Its survey, designs, proposals, bookings, checklists, test results, paperwork and files go with it. The customer and their messages stay."
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-3 text-sm", !last && "border-b border-divider")}>
      <span className="text-ink-3">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
