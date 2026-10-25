import { PageHeader } from "@/components/domain";
import { SettingsNav } from "@/components/settings-nav";
import { requireAdmin } from "@/lib/auth";

const SECTIONS = [
  { href: "/settings/company", label: "Company details" },
  { href: "/settings/team", label: "Team & permissions" },
  { href: "/settings/email", label: "Email sending" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/sms", label: "SMS add-on" },
  { href: "/settings/products", label: "Products & suppliers" },
  { href: "/settings/design", label: "Design rules" },
  { href: "/settings/surveys", label: "Surveys & templates" },
  { href: "/settings/invoices", label: "Invoices & quotes" },
  { href: "/settings/checklists", label: "Install checklists" },
  { href: "/settings/marketing", label: "Marketing" },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Settings" description="Used across proposals, invoices and paperwork. Only admins can change these." />
      <div className="flex flex-wrap items-start gap-8 max-md:gap-5">
        <SettingsNav sections={SECTIONS} />
        <div className="flex min-w-0 max-w-[860px] flex-[999_1_560px] flex-col gap-6">
          {children}
          <p className="text-xs text-muted-foreground">
            Integrations arrive with the phases that use them.
          </p>
        </div>
      </div>
    </>
  );
}
