import { Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { productLabel, StageChip } from "@/components/domain";
import { buttonVariants } from "@/components/ui/button";
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

  const address = addressLine(project.site_address_line1, project.site_town) || "Project";
  const productsText = project.products.map(productLabel).join(", ").replace(/, ([^,]*)$/, " and $1");

  return (
    <div data-project-page className="flex min-h-dvh flex-col">
      <header className="flex flex-col gap-3.5 border-b bg-card px-8 pt-[18px] max-md:px-4">
        <nav aria-label="Breadcrumb" className="text-[13px] text-muted-foreground">
          <Link href="/projects" className="hover:text-foreground">
            Projects
          </Link>{" "}
          / {project.site_address_line1 || "Project"}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-[-0.02em]">{address}</h1>
              <StageChip stage={project.stage} />
            </div>
            <p className="text-sm text-ink-3">
              <Link href={`/contacts/${project.contact_id}`} className="font-semibold text-primary hover:text-accent-strong">
                {project.contact_name}
              </Link>
              {[productsText, project.site_postcode].filter(Boolean).map((part) => ` · ${part}`)}
            </p>
          </div>
          <Link href={`/contacts/${project.contact_id}`} className={buttonVariants({ variant: "outline" })}>
            Message
          </Link>
        </div>
        <nav aria-label="Project sections" className="flex overflow-x-auto">
          {PROJECT_TABS.map((t) => (
            <ProjectTabLink key={t.slug} href={`/projects/${id}${t.slug ? `/${t.slug}` : ""}`} exact={!t.slug}>
              {tabDone(t.doneAt, project.stage, project.lost_from_stage) && (
                <>
                  <Check className="size-3.5 text-success" strokeWidth={2.5} aria-hidden />
                  <span className="sr-only">(done)</span>
                </>
              )}
              {t.label}
            </ProjectTabLink>
          ))}
        </nav>
      </header>
      <div className="mx-auto w-full max-w-[1360px] px-8 pt-6 pb-10 max-md:px-4">{children}</div>
    </div>
  );
}
