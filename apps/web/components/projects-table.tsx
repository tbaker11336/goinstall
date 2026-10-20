import { PROJECT_STAGE_INFO } from "@goinstall/core";
import Link from "next/link";
import { EmptyState, ProductTags, StageChip } from "@/components/domain";
import type { ProjectRow } from "@/lib/queries";
import { addressLine } from "@/lib/utils";

export function ProjectsTable({ projects, empty = "No projects match." }: { projects: ProjectRow[]; empty?: string }) {
  if (!projects.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="px-3 py-2 font-medium">Project</th>
            <th scope="col" className="px-3 py-2 font-medium">Products</th>
            <th scope="col" className="px-3 py-2 font-medium">Stage</th>
            <th scope="col" className="px-3 py-2 font-medium">Next step</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="relative border-b last:border-0 hover:bg-muted/60">
              <td className="px-3 py-2">
                {/* The link covers the whole row, so the row is clickable. */}
                <Link href={`/projects/${p.id}`} className="font-medium after:absolute after:inset-0">
                  {addressLine(p.site_address_line1, p.site_postcode) || "No site address"}
                </Link>
                <span className="block text-xs text-muted-foreground">{p.contact_name}</span>
              </td>
              <td className="px-3 py-2">
                <ProductTags products={p.products} />
              </td>
              <td className="px-3 py-2">
                <StageChip stage={p.stage} />
              </td>
              <td className="px-3 py-2 text-muted-foreground">{p.stage === "lost" ? "—" : (PROJECT_STAGE_INFO[p.stage].nextAction ?? "Done")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
