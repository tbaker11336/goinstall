import { PROJECT_STAGES, stageLabel, type ProjectStage } from "@goinstall/core";
import { Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/domain";
import { ProjectsTable } from "@/components/projects-table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { asUser } from "@/lib/auth";
import { listProjects } from "@/lib/queries";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ stage?: string; q?: string }> }) {
  const sp = await searchParams;
  const stage = [...PROJECT_STAGES, "lost"].includes(sp.stage ?? "") ? (sp.stage as ProjectStage) : undefined;
  const projects = await asUser((tx) => listProjects(tx, { stage, q: sp.q?.trim() || undefined }));
  return (
    <>
      <PageHeader
        title="Projects"
        description={stage ? `At ${stageLabel(stage)}` : "Every job, newest activity first."}
        actions={
          <Link href="/contacts/new" className={buttonVariants()}>
            <Plus aria-hidden /> New enquiry
          </Link>
        }
      />
      <form role="search" action="/projects" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Search
          <Input name="q" defaultValue={sp.q} placeholder="Customer, address or postcode" className="w-64" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Stage
          <Select name="stage" defaultValue={stage ?? ""} className="w-44">
            <option value="">Any</option>
            {[...PROJECT_STAGES, "lost" as const].map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <Card>
        <ProjectsTable projects={projects} />
      </Card>
    </>
  );
}
