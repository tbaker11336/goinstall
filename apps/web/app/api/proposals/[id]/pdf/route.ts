import { z } from "zod";
import { asUser } from "@/lib/auth";
import { proposalPdfResponse } from "@/lib/proposal-pdf";
import { proposalContent } from "@/lib/proposals";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const content = await asUser((tx) => proposalContent(tx, id));
  if (!content) return new Response("Not found", { status: 404 });
  return proposalPdfResponse(content);
}
