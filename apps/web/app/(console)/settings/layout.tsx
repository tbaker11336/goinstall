import { PageHeader } from "@/components/domain";
import { ProjectTabLink } from "@/components/project-tab-link";
import { requireAdmin } from "@/lib/auth";

const SECTIONS = [
  { href: "/settings/company", label: "Company details" },
  { href: "/settings/team", label: "Team & permissions" },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Settings" description="Only admins can change these." />
      <nav aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto border-b">
        {SECTIONS.map((s) => (
          <ProjectTabLink key={s.href} href={s.href}>
            {s.label}
          </ProjectTabLink>
        ))}
      </nav>
      {children}
      <p className="mt-8 text-xs text-muted-foreground">
        Invoices &amp; quotes, integrations, products &amp; suppliers and survey/checklist settings arrive with the phases that use them.
      </p>
    </>
  );
}
