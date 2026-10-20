import { PROJECT_STAGES, stageLabel, type ProjectStage } from "@goinstall/core";
import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/domain";
import { ProjectsTable } from "@/components/projects-table";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { asUser } from "@/lib/auth";
import { listProjects, projectStageCounts } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

const TILES: { label: string; href: string; count: (c: Partial<Record<ProjectStage, number>>, newContacts: number) => number; hint?: string }[] = [
  { label: "New enquiries", href: "/contacts?stage=new_enquiry", count: (_, n) => n },
  { label: "Surveys due", href: "/projects?stage=survey", count: (c) => c.survey ?? 0 },
  { label: "Proposals awaiting acceptance", href: "/projects?stage=proposal_sent", count: (c) => c.proposal_sent ?? 0 },
  { label: "Kit to order", href: "/projects?stage=deposit_paid", count: (c) => c.deposit_paid ?? 0 },
  { label: "Installs scheduled", href: "/projects?stage=scheduled", count: (c) => c.scheduled ?? 0, hint: "Install dates arrive with scheduling" },
];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const { stage: stageParam } = await searchParams;
  const stage = (PROJECT_STAGES as readonly string[]).includes(stageParam ?? "") || stageParam === "lost" ? (stageParam as ProjectStage) : undefined;

  const { counts, newContacts, projects, actions, unread, firstName } = await asUser(async (tx, session) => {
    const [counts, newContacts, projects, actions, unread] = await Promise.all([
      projectStageCounts(tx),
      tx
        .selectFrom("contacts")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("stage", "=", "new_enquiry")
        .executeTakeFirstOrThrow(),
      listProjects(tx, { stage, limit: 25 }),
      // Events needing action today. Bookings (surveys, installs) join this
      // list in phase 5.
      listProjects(tx, { stage: ["accepted", "deposit_paid"], limit: 10 }),
      tx
        .selectFrom("messages as m")
        .innerJoin("contacts as c", "c.id", "m.contact_id")
        .select(["m.id", "m.channel", "m.body", "m.created_at", "c.id as contact_id", "c.name"])
        .where("m.direction", "=", "inbound")
        .where("m.read_at", "is", null)
        .orderBy("m.created_at", "desc")
        .limit(6)
        .execute(),
    ]);
    return { counts, newContacts: Number(newContacts.n), projects, actions, unread, firstName: session.fullName.split(" ")[0] };
  });

  return (
    <>
      <PageHeader
        title={`Hello, ${firstName}`}
        description="What needs doing across your jobs."
        actions={
          <Link href="/contacts/new" className={buttonVariants()}>
            <Plus aria-hidden /> New enquiry
          </Link>
        }
      />

      <ul className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {TILES.map((t) => (
          <li key={t.label}>
            <Link href={t.href} className="block rounded-lg border bg-card p-4 transition-colors hover:border-primary">
              <span className="block text-2xl font-semibold tabular-nums">{t.count(counts, newContacts)}</span>
              <span className="block text-sm text-muted-foreground">{t.label}</span>
              {t.hint && <span className="mt-1 block text-xs text-muted-foreground/80">{t.hint}</span>}
            </Link>
          </li>
        ))}
      </ul>

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
            <Link href="/projects" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <nav aria-label="Filter by stage" className="flex flex-wrap gap-2 border-b px-4 py-3">
            <StageFilterChip href="/dashboard" active={!stage} label="All" />
            {[...PROJECT_STAGES, "lost" as const].map((s) => (
              <StageFilterChip key={s} href={`/dashboard?stage=${s}`} active={stage === s} label={stageLabel(s)} count={counts[s]} />
            ))}
          </nav>
          <ProjectsTable projects={projects} empty={stage ? `No projects at ${stageLabel(stage)}.` : "No projects yet. Create an enquiry to start."} />
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Today</CardTitle>
            </CardHeader>
            <CardContent>
              {actions.length ? (
                <ul className="grid gap-3 text-sm">
                  {actions.map((a) => (
                    <li key={a.id}>
                      <Link href={`/projects/${a.id}`} className="font-medium hover:underline">
                        {a.stage === "deposit_paid" ? "Deposit received → order kit" : "Accepted → chase deposit"}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {a.contact_name} · {a.site_postcode}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>Nothing needs action right now.</EmptyState>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Unread messages</CardTitle>
            </CardHeader>
            <CardContent>
              {unread.length ? (
                <ul className="grid gap-3 text-sm">
                  {unread.map((m) => (
                    <li key={m.id}>
                      <Link href={`/contacts/${m.contact_id}`} className="font-medium hover:underline">
                        {m.name}
                      </Link>
                      <span className="ml-2 text-xs capitalize text-muted-foreground">
                        {m.channel} · {timeAgo(m.created_at)}
                      </span>
                      <p className="line-clamp-2 text-muted-foreground">{m.body}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>No unread messages. Email and WhatsApp replies appear here once messaging is connected.</EmptyState>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function StageFilterChip({ href, active, label, count }: { href: string; active: boolean; label: string; count?: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:border-primary",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card",
      )}
    >
      {label}
      {count ? <span className="ml-1 tabular-nums opacity-70">{count}</span> : null}
    </Link>
  );
}
