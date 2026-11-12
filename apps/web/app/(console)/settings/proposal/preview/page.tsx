import Link from "next/link";
import { ProposalDocument } from "@/components/proposal-document";
import { asUser } from "@/lib/auth";
import { proposalContent, proposalViewWithLayout } from "@/lib/proposals";

export const metadata = { title: "Proposal template preview" };

/** The saved template around the company's most recent proposal, as a customer would see it. */
export default async function ProposalTemplatePreview() {
  const content = await asUser(
    async (tx, s) => {
      const latest = await tx.selectFrom("proposals").select("id").where("company_id", "=", s.companyId).orderBy("created_at", "desc").limit(1).executeTakeFirst();
      return latest ? proposalContent(tx, latest.id, s.companyId, { companyTemplate: true }) : null;
    },
    ["admin"],
  );
  const view = content ? await proposalViewWithLayout(content) : null;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Preview</h2>
          <p className="text-sm text-ink-3">{view ? `Your saved template around your latest proposal (${view.number}). Save changes to see them here.` : ""}</p>
        </div>
        <Link href="/settings/proposal" className="text-sm font-semibold text-primary underline">
          Back to the template
        </Link>
      </div>
      {view ? <ProposalDocument p={view} /> : <p className="rounded-[14px] border bg-card p-6 text-sm text-ink-3">Create a proposal on a project to preview the template with it.</p>}
    </div>
  );
}
