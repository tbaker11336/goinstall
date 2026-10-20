import type { ProjectStage } from "@goinstall/core";
import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/domain";
import { ProjectsTable } from "@/components/projects-table";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { asUser } from "@/lib/auth";
import { listProjects, projectStageCounts } from "@/lib/queries";
import { Avatar } from "@/components/domain";
import { cn, formatMoney, timeAgo } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

type Counts = Partial<Record<ProjectStage, number>>;

const TILES: { label: string; href: string; count: (c: Counts, newContacts: number) => number; sub: (c: Counts) => string; warn?: boolean }[] = [
  { label: "New enquiries", href: "/contacts?stage=new_enquiry", count: (_, n) => n, sub: () => "Contacts not yet surveyed" },
  { label: "Surveys due", href: "/projects?stage=survey", count: (c) => c.survey ?? 0, sub: () => "Projects at survey" },
  { label: "Proposals awaiting", href: "/projects?stage=proposal_sent", count: (c) => c.proposal_sent ?? 0, sub: (c) => (c.accepted ? `${c.accepted} accepted, deposit due` : "Sent, not yet accepted") },
  { label: "Kit to order", href: "/projects?stage=deposit_paid", count: (c) => c.deposit_paid ?? 0, sub: () => "Deposits paid, not ordered", warn: true },
  { label: "Installs scheduled", href: "/projects?stage=scheduled", count: (c) => c.scheduled ?? 0, sub: () => "Dates arrive with scheduling" },
];

/** Filter chips group the nine stages the way the office thinks about them. */
const GROUPS: { key: string; label: string; stages: ProjectStage[] }[] = [
  { key: "enquiry", label: "Enquiry", stages: ["enquiry"] },
  { key: "survey", label: "Survey", stages: ["survey"] },
  { key: "design", label: "Design", stages: ["design"] },
  { key: "proposal", label: "Proposal", stages: ["proposal_sent", "accepted"] },
  { key: "delivery", label: "Delivery", stages: ["deposit_paid", "kit_ordered", "scheduled", "complete"] },
  { key: "lost", label: "Lost", stages: ["lost"] },
];

function greeting(now: Date) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group: groupParam } = await searchParams;
  const group = GROUPS.find((g) => g.key === groupParam);

  const { counts, newContacts, projects, actions, unread, firstName } = await asUser(async (tx, session) => {
    const [counts, newContacts, projects, actions, unread] = await Promise.all([
      projectStageCounts(tx),
      tx
        .selectFrom("contacts")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("stage", "=", "new_enquiry")
        .executeTakeFirstOrThrow(),
      listProjects(tx, { stage: group?.stages, limit: 25 }),
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

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }).format(now);
  const groupCount = (g: (typeof GROUPS)[number]) => g.stages.reduce((n, st) => n + (counts[st] ?? 0), 0);
  const total = GROUPS.filter((g) => g.key !== "lost").reduce((n, g) => n + groupCount(g), 0);

  return (
    <>
      <PageHeader
        title={`${greeting(now)}, ${firstName}`}
        description={`${today} · ${actions.length ? `${actions.length} ${actions.length === 1 ? "job needs" : "jobs need"} action` : "nothing urgent"}`}
        actions={
          <Link href="/contacts/new" className={buttonVariants()}>
            <Plus className="size-[18px]" strokeWidth={2} aria-hidden /> New enquiry
          </Link>
        }
      />

      <ul className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {TILES.map((t) => {
          const n = t.count(counts, newContacts);
          const warn = t.warn && n > 0;
          return (
            <li key={t.label}>
              <Link
                href={t.href}
                className={cn(
                  "flex h-full flex-col gap-1.5 rounded-lg border bg-card px-5 py-[18px] transition-colors hover:border-primary",
                  warn && "border-warning-border bg-warning-tint hover:border-warning",
                )}
              >
                <span className={cn("text-sm font-medium text-ink-3", warn && "text-warning-text")}>{t.label}</span>
                <span className="stat text-[28px] leading-tight font-bold">{n}</span>
                <span className={cn("text-[12.5px] text-muted-foreground", warn && "text-warning-text")}>{t.sub(counts)}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_minmax(20rem,26rem)]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px] pb-4">
            <h2 className="text-[17px] font-bold">Projects</h2>
            <nav aria-label="Filter by stage" className="flex flex-wrap gap-2">
              <StageFilterChip href="/dashboard" active={!group} label="All" count={total} />
              {GROUPS.map((g) => (
                <StageFilterChip key={g.key} href={`/dashboard?group=${g.key}`} active={group?.key === g.key} label={g.label} count={groupCount(g)} />
              ))}
            </nav>
          </div>
          <ProjectsTable projects={projects} empty={group ? `No projects at ${group.label}.` : "No projects yet. Create an enquiry to start."} />
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-[17px]">Today</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {actions.length ? (
                actions.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-[10px] border border-warning-border bg-warning-tint px-4 py-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm font-semibold">{a.stage === "deposit_paid" ? "Deposit received" : "Proposal accepted"}</span>
                      <span className="truncate text-[13px] text-warning-text">
                        {[a.site_address_line1, a.value ? formatMoney(a.value) : null].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <Link href={`/projects/${a.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      {a.stage === "deposit_paid" ? "Order kit" : "Chase deposit"}
                    </Link>
                  </div>
                ))
              ) : (
                <EmptyState>Nothing needs action right now. Surveys and installs appear here once scheduling arrives.</EmptyState>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-[17px]">Messages</CardTitle>
            </CardHeader>
            <CardContent>
              {unread.length ? (
                <ul className="flex flex-col">
                  {unread.map((m) => (
                    <li key={m.id} className="relative flex items-center gap-3 border-b border-divider py-3 last:border-0">
                      <Avatar name={m.name} size="md" className="size-10" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="flex justify-between gap-2">
                          <Link href={`/contacts/${m.contact_id}`} className="text-sm font-semibold after:absolute after:inset-0">
                            {m.name}
                          </Link>
                          <span className="text-xs text-muted-foreground">{timeAgo(m.created_at)}</span>
                        </span>
                        <span className="truncate text-[13px] text-ink-3">
                          <span className="capitalize">{m.channel === "whatsapp" ? "WhatsApp" : m.channel}</span> · {m.body}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState>No unread messages. Customer email replies appear here once inbound email is connected.</EmptyState>
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
        "inline-flex h-9 items-center rounded-full border border-input px-3.5 text-[13px] font-semibold text-ink-2 transition-colors hover:border-primary",
        active ? "border-foreground bg-foreground text-white hover:border-foreground" : "bg-card",
      )}
    >
      {label}
      {count ? <span className="ml-1.5 tabular-nums">{count}</span> : null}
    </Link>
  );
}
