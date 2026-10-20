import { withService } from "@goinstall/db";
import { db } from "@/lib/db";
import { proposalPdfResponse } from "@/lib/proposal-pdf";
import { findPublicProposal, proposalContent } from "@/lib/proposals";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const content = await withService(db(), async (tx) => {
    const p = await findPublicProposal(tx, token);
    return p ? proposalContent(tx, p.id, p.companyId) : null;
  });
  if (!content) return new Response("This link isn't working", { status: 404 });
  return proposalPdfResponse(content);
}
