import { PROJECT_STAGE_INFO } from "@goinstall/core";
import Link from "next/link";
import { Avatar, EmptyState, ProductTags, StageChip } from "@/components/domain";
import type { ProjectRow } from "@/lib/queries";
import { addressLine, formatMoney } from "@/lib/utils";

export function ProjectsTable({ projects, empty = "No projects match." }: { projects: ProjectRow[]; empty?: string }) {
  if (!projects.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-subtle text-left text-[13px] text-ink-3">
          <tr className="border-b">
            <th scope="col" className="px-5 py-2.5 font-semibold">Project</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Products</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Stage</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Value</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Next step</th>
            <th scope="col" className="px-5 py-2.5 text-right font-semibold">Owner</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="relative border-b border-divider last:border-0 hover:bg-surface-subtle">
              <td className="px-5 py-3.5">
                {/* The link covers the whole row, so the row is clickable. */}
                <Link href={`/projects/${p.id}`} className="font-semibold after:absolute after:inset-0">
                  {addressLine(p.site_address_line1, p.site_town) || "No site address"}
                </Link>
                <span className="block text-[13px] text-ink-3">{p.contact_name}</span>
              </td>
              <td className="px-3 py-3.5">
                <ProductTags products={p.products} />
              </td>
              <td className="px-3 py-3.5">
                <StageChip stage={p.stage} />
              </td>
              <td className="px-3 py-3.5 text-right whitespace-nowrap tabular-nums">{p.value ? formatMoney(p.value) : "—"}</td>
              <td className="px-3 py-3.5 text-ink-3">{p.stage === "lost" ? "—" : (PROJECT_STAGE_INFO[p.stage].nextAction ?? "Done")}</td>
              <td className="px-5 py-3.5 text-right">{p.owner_name ? <Avatar name={p.owner_name} className="size-7" /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
