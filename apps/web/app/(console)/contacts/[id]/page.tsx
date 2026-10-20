import { ArrowLeft, Mail, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ContactFields, ProductCheckboxes } from "@/components/contact-fields";
import { ContactStageChip, EmptyState, ProductTags, StageChip } from "@/components/domain";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Thread, THREAD_TABS, type ThreadTab } from "@/components/thread";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/input";
import { addNoteAction, addProjectAction, updateContactAction } from "@/lib/actions/crm";
import { asUser } from "@/lib/auth";
import { contactTimeline, listSources, listStaff } from "@/lib/queries";
import { addressLine, formatMoney } from "@/lib/utils";

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const tab: ThreadTab = THREAD_TABS.some((t) => t.key === tabParam) ? (tabParam as ThreadTab) : "all";

  const data = await asUser(async (tx) => {
    const contact = await tx.selectFrom("contacts").selectAll().where("id", "=", id).executeTakeFirst();
    if (!contact) return null;
    const [projects, timeline, staff, sources] = await Promise.all([
      tx
        .selectFrom("projects")
        .select(["id", "site_address_line1", "site_postcode", "products", "stage", "value"])
        .where("contact_id", "=", id)
        .orderBy("created_at", "desc")
        .execute(),
      contactTimeline(tx, id),
      listStaff(tx),
      listSources(tx),
    ]);
    return { contact, projects, timeline, staff, sources };
  });
  if (!data) notFound();
  const { contact, projects, timeline, staff, sources } = data;

  return (
    <>
      <Link href="/contacts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Contacts
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{contact.name}</h1>
        <ContactStageChip stage={contact.stage} />
        {contact.stage === "lost" && contact.lost_reason && <span className="text-sm text-muted-foreground">{contact.lost_reason}</span>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <span className="flex gap-1">
                {contact.phone && (
                  <a href={`tel:${contact.phone}`} className="rounded p-1.5 hover:bg-muted" aria-label={`Call ${contact.phone}`}>
                    <Phone className="size-4" />
                  </a>
                )}
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="rounded p-1.5 hover:bg-muted" aria-label={`Email ${contact.email}`}>
                    <Mail className="size-4" />
                  </a>
                )}
              </span>
            </CardHeader>
            <CardContent>
              <ActionForm action={updateContactAction.bind(null, contact.id)} className="grid gap-4">
                <ContactFields values={contact} staff={staff} extraSources={sources} />
                <ProductCheckboxes selected={contact.interested_in} />
                <div>
                  <SubmitButton size="sm">Save details</SubmitButton>
                </div>
              </ActionForm>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {projects.length ? (
                <ul className="grid gap-2">
                  {projects.map((p) => (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="block rounded-md border p-3 text-sm hover:border-primary">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{addressLine(p.site_address_line1, p.site_postcode) || "No site address"}</span>
                          <StageChip stage={p.stage} />
                        </span>
                        <span className="mt-2 flex items-center justify-between gap-2">
                          <ProductTags products={p.products} />
                          <span className="text-xs text-muted-foreground">{formatMoney(p.value)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>No projects yet.</EmptyState>
              )}
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-primary">Add a project</summary>
                <ActionForm action={addProjectAction.bind(null, contact.id)} className="mt-3 grid gap-3">
                  <ProductCheckboxes legend="Products" selected={contact.interested_in} />
                  <p className="text-xs text-muted-foreground">Uses the contact's address as the site address; you can change it on the project.</p>
                  <div>
                    <SubmitButton size="sm" variant="outline">
                      Create project
                    </SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
          </CardHeader>
          <div className="border-b p-4">
            <ActionForm action={addNoteAction.bind(null, contact.id)} className="grid gap-3" resetOnSuccess>
              <div className="flex flex-wrap gap-3">
                <Field label="Channel" htmlFor="channel" className="w-40">
                  <Select id="channel" name="channel" defaultValue="note" aria-describedby="channel-hint">
                    <option value="note">Note</option>
                    <option value="email" disabled>
                      Email (phase 2)
                    </option>
                    <option value="whatsapp" disabled>
                      WhatsApp (phase 2)
                    </option>
                  </Select>
                </Field>
                {projects.length > 1 && (
                  <Field label="Project" htmlFor="project_id" className="min-w-48 flex-1">
                    <Select id="project_id" name="project_id" defaultValue="">
                      <option value="">Not about one project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {addressLine(p.site_address_line1, p.site_postcode) || "Project"}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {projects.length === 1 && <input type="hidden" name="project_id" value={projects[0]!.id} />}
              </div>
              <Field label="Note" htmlFor="body">
                <Textarea id="body" name="body" required placeholder="Add a note for the team…" />
              </Field>
              <p id="channel-hint" className="sr-only">
                Email and WhatsApp sending arrives in phase 2.
              </p>
              <div>
                <SubmitButton size="sm">Add note</SubmitButton>
              </div>
            </ActionForm>
          </div>
          <Thread messages={timeline.messages} events={timeline.events} tab={tab} tabHref={(t) => `/contacts/${contact.id}${t === "all" ? "" : `?tab=${t}`}`} />
        </Card>
      </div>
    </>
  );
}
