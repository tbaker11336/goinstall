import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProductTags, StageChip } from "@/components/domain";
import { ProjectTabLink } from "@/components/project-tab-link";
import { asUser } from "@/lib/auth";
import { addressLine } from "@/lib/utils";
import { PROJECT_TABS, tabDone } from "./tabs";

export default async function ProjectLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const project = await asUser((tx) =>
    tx
      .selectFrom("projects as p")
      .innerJoin("contacts as c", "c.id", "p.contact_id")
      .select(["p.id", "p.stage", "p.lost_from_stage", "p.products", "p.site_address_line1", "p.site_town", "p.site_postcode", "c.id as contact_id", "c.name as contact_name"])
      .where("p.id", "=", id)
      .executeTakeFirst(),
  );
  if (!project) notFound();

  return (
    <>
      <Link href="/dashboard" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Dashboard
      </Link>
      <header className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{addressLine(project.site_address_line1, project.site_town, project.site_postcode) || "Project"}</h1>
        <StageChip stage={project.stage} />
        <ProductTags products={project.products} />
        <Link href={`/contacts/${project.contact_id}`} className="text-sm text-primary hover:underline">
          {project.contact_name}
        </Link>
      </header>
      <nav aria-label="Project sections" className="mb-6 flex gap-1 overflow-x-auto border-b">
        {PROJECT_TABS.map((t) => (
          <ProjectTabLink key={t.slug} href={`/projects/${id}${t.slug ? `/${t.slug}` : ""}`} exact={!t.slug}>
            {t.label}
            {tabDone(t.doneAt, project.stage, project.lost_from_stage) && (
              <>
                <Check className="size-3.5 text-emerald-600" aria-hidden />
                <span className="sr-only">(done)</span>
              </>
            )}
          </ProjectTabLink>
        ))}
      </nav>
      {children}
    </>
  );
}
