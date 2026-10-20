import { PROJECT_STAGE_INFO, PROJECT_STAGES, stageIndex, stageLabel, type ActiveProjectStage } from "@goinstall/core";
import { Check, Circle, Mail, MessageSquare, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCheckboxes } from "@/components/contact-fields";
import { ActionForm, SubmitButton } from "@/components/forms";
import { StageControls } from "@/components/stage-controls";
import { Thread } from "@/components/thread";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { addNoteAction, updateProjectAction } from "@/lib/actions/crm";
import { asUser } from "@/lib/auth";
import { contactTimeline, listStaff } from "@/lib/queries";
import { cn, formatDate } from "@/lib/utils";

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await asUser(async (tx) => {
    const project = await tx
      .selectFrom("projects as p")
      .innerJoin("contacts as c", "c.id", "p.contact_id")
      .select([
        "p.id",
        "p.stage",
        "p.lost_from_stage",
        "p.lost_reason",
        "p.products",
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
    return { project, timeline, staff };
  });
  if (!data) notFound();
  const { project: p, timeline, staff } = data;

  const reached: ActiveProjectStage = p.stage !== "lost" ? p.stage : p.lost_from_stage && p.lost_from_stage !== "lost" ? p.lost_from_stage : "enquiry";
  const info = p.stage === "lost" ? null : PROJECT_STAGE_INFO[p.stage];
  const month = p.target_install_month ? new Date(p.target_install_month).toISOString().slice(0, 7) : "";

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <div className="grid content-start gap-6">
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle>Next step</CardTitle>
            <span className="text-xs text-muted-foreground">In {stageLabel(p.stage)} since {formatDate(p.stage_changed_at)}</span>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[1fr_18rem]">
            <div>
              {p.stage === "lost" ? (
                <>
                  <p className="font-medium">This project was lost{p.lost_from_stage ? ` at ${stageLabel(p.lost_from_stage)}` : ""}.</p>
                  <p className="text-sm text-muted-foreground">Reason: {p.lost_reason}</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium">{info?.nextAction ?? "Job complete"}</p>
                  <p className="text-sm text-muted-foreground">
                    Tools for this step arrive in later phases. For now, move the stage when it's done.
                  </p>
                </>
              )}
            </div>
            <StageControls projectId={p.id} stage={p.stage} lostFromStage={p.lost_from_stage} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <div className="border-b p-4">
            <ActionForm action={addNoteAction.bind(null, p.contact_id)} className="grid gap-3" resetOnSuccess>
              <input type="hidden" name="project_id" value={p.id} />
              <Field label="Add a note" htmlFor="body">
                <Textarea id="body" name="body" required placeholder="Visible to the team on this project and the contact's thread" />
              </Field>
              <div>
                <SubmitButton size="sm">Add note</SubmitButton>
              </div>
            </ActionForm>
          </div>
          <Thread messages={timeline.messages} events={timeline.events} tab="all" />
        </Card>
      </div>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Project journey</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2 text-sm">
              {PROJECT_STAGES.map((s) => {
                const done = stageIndex(s) < stageIndex(reached) || (s === "complete" && reached === "complete");
                const current = s === reached && p.stage !== "lost" && s !== "complete";
                return (
                  <li key={s} className={cn("flex items-center gap-2", !done && !current && "text-muted-foreground")} aria-current={current ? "step" : undefined}>
                    {done ? (
                      <Check className="size-4 text-emerald-600" aria-label="Done" />
                    ) : (
                      <Circle className={cn("size-4", current && "fill-primary text-primary")} aria-label={current ? "Current" : "To do"} />
                    )}
                    <span className={cn(current && "font-medium")}>{PROJECT_STAGE_INFO[s].label}</span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <Link href={`/contacts/${p.contact_id}`} className="font-medium hover:underline">
              {p.contact_name}
            </Link>
            {p.contact_phone && (
              <a href={`tel:${p.contact_phone}`} className="flex items-center gap-2 hover:underline">
                <Phone className="size-4" aria-hidden /> {p.contact_phone}
              </a>
            )}
            {p.contact_email && (
              <a href={`mailto:${p.contact_email}`} className="flex items-center gap-2 break-all hover:underline">
                <Mail className="size-4" aria-hidden /> {p.contact_email}
              </a>
            )}
            <Link href={`/contacts/${p.contact_id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <MessageSquare aria-hidden /> Message customer
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Key details</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={updateProjectAction.bind(null, p.id)} className="grid gap-4">
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
            <p className="mt-4 text-xs text-muted-foreground">Created {formatDate(p.created_at)}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
