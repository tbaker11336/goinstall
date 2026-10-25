import { Phone, Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ContactFields, ProductCheckboxes } from "@/components/contact-fields";
import { Avatar, ContactStageChip, EmptyState, productLabel, ProductTags, StageChip } from "@/components/domain";
import { Composer } from "@/components/composer";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Thread, THREAD_TABS, type ThreadTab } from "@/components/thread";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addProjectAction, updateContactAction } from "@/lib/actions/crm";
import { withService } from "@goinstall/db";
import { ukMobileE164 } from "@goinstall/core";
import { asUser, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { activeSms } from "@/lib/sms";
import { emailConfigured } from "@/lib/email";
import { contactTimeline, listSources, listStaff } from "@/lib/queries";
import { addressLine, cn, formatMoney } from "@/lib/utils";

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const tab: ThreadTab = THREAD_TABS.some((t) => t.key === tabParam) ? (tabParam as ThreadTab) : "all";

  const data = await asUser(async (tx) => {
    const contact = await tx.selectFrom("contacts").selectAll().where("id", "=", id).executeTakeFirst();
    if (!contact) return null;
    const [projects, timeline, staff, sources, templates] = await Promise.all([
      tx
        .selectFrom("projects")
        .select(["id", "site_address_line1", "site_postcode", "products", "stage", "value"])
        .where("contact_id", "=", id)
        .orderBy("created_at", "desc")
        .execute(),
      contactTimeline(tx, id),
      listStaff(tx),
      listSources(tx),
      // The team's own templates; app templates (e.g. the survey link) have a key.
      tx
        .selectFrom("message_templates")
        .select(["id", "name", "subject", "body"])
        .where("channel", "=", "email")
        .where("key", "is", null)
        .where("archived_at", "is", null)
        .orderBy("name")
        .execute(),
    ]);
    return { contact, projects, timeline, staff, sources, templates };
  });
  if (!data) notFound();
  // The add-on's number (billing rows are admin-only, so read for this company server-side).
  const session = await requireSession();
  const smsNumber = (await withService(db(), (tx) => activeSms(tx, session.companyId)))?.phone_number ?? null;
  const { contact, projects, timeline, staff, sources, templates } = data;

  const owner = staff.find((u) => u.id === contact.owner_id)?.full_name;
  const since = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" }).format(new Date(contact.created_at));
  const address = addressLine(contact.address_line1, contact.address_line2, contact.town, contact.postcode);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-5 text-[13px] text-muted-foreground">
        <Link href="/contacts" className="hover:text-foreground">
          Contacts
        </Link>{" "}
        / {contact.name}
      </nav>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={contact.name} size="lg" />
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-[-0.02em]">{contact.name}</h1>
              <ContactStageChip stage={contact.stage} />
            </div>
            <span className="text-sm text-ink-3">
              {contact.stage === "lost" && contact.lost_reason ? `Lost: ${contact.lost_reason}` : `Contact since ${since}`}
              {owner && ` · Owner ${owner}`}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {contact.phone && (
            <a href={`tel:${contact.phone}`} className={buttonVariants({ variant: "outline" })}>
              <Phone aria-hidden /> Call
            </a>
          )}
          <a href="#add-project" className={buttonVariants()}>
            <Plus className="size-[18px]" strokeWidth={2} aria-hidden /> New project
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <aside className="flex max-w-[360px] flex-[1_1_300px] flex-col gap-5 max-md:max-w-none">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col pt-0">
              <Detail label="Mobile" value={contact.phone ? <a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a> : null} />
              <Detail label="Email" value={contact.email ? <a href={`mailto:${contact.email}`} className="break-all hover:underline">{contact.email}</a> : null} />
              <Detail label="Address" value={address || null} />
              <Detail label="Source" value={contact.source} />
              <Detail
                label="Interested in"
                value={contact.interested_in.length ? <ProductTags products={contact.interested_in} className="pt-1" /> : null}
                last
              />
              <details className="mt-1">
                <summary className="cursor-pointer text-sm font-semibold text-primary hover:text-accent-strong">Edit details</summary>
                <ActionForm action={updateContactAction.bind(null, contact.id)} className="mt-4 grid gap-4">
                  <ContactFields values={contact} staff={staff} extraSources={sources} />
                  <ProductCheckboxes selected={contact.interested_in} />
                  <div>
                    <SubmitButton size="sm">Save details</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {projects.length ? (
                <ul className="flex flex-col gap-2.5">
                  {projects.map((p) => (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="flex items-center justify-between gap-3 rounded-[10px] border p-3 hover:border-primary">
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-sm font-semibold">{p.products.map(productLabel).join(", ") || "No products"}</span>
                          <span className="truncate text-[12.5px] text-muted-foreground">
                            {[p.value ? formatMoney(p.value) : null, p.site_address_line1].filter(Boolean).join(" · ") || "No site address"}
                          </span>
                        </span>
                        <StageChip stage={p.stage} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>No projects yet.</EmptyState>
              )}
              <details id="add-project" className="text-sm">
                <summary className="cursor-pointer font-semibold text-primary hover:text-accent-strong">Add a project</summary>
                <ActionForm action={addProjectAction.bind(null, contact.id)} className="mt-3 grid gap-3">
                  <ProductCheckboxes legend="Products" selected={contact.interested_in} />
                  <p className="text-xs text-muted-foreground">Uses the contact&apos;s address as the site address; you can change it on the project.</p>
                  <div>
                    <SubmitButton size="sm" variant="outline">
                      Create project
                    </SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </CardContent>
          </Card>
        </aside>

        <Card className="flex min-w-0 flex-[999_1_520px] flex-col overflow-hidden" aria-label="Conversation">
          <Thread messages={timeline.messages} events={timeline.events} tab={tab} tabHref={(t) => `/contacts/${contact.id}${t === "all" ? "" : `?tab=${t}`}`} />
          <Composer
            sms={smsNumber ? { number: smsNumber, mobile: ukMobileE164(contact.phone), optedOut: Boolean(contact.sms_opt_out_at) } : null}
            contactId={contact.id}
            contactEmail={contact.email}
            projects={projects.map((p) => ({ id: p.id, label: addressLine(p.site_address_line1, p.site_postcode) || "Project" }))}
            templates={templates}
            emailLive={emailConfigured()}
          />
        </Card>
      </div>
    </>
  );
}

function Detail({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-0.5 py-2.5", !last && "border-b border-divider")}>
      <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value ?? <span className="text-muted-foreground">Not set</span>}</span>
    </div>
  );
}
