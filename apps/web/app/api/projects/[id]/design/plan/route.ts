import { z } from "zod";
import { asUser } from "@/lib/auth";
import { aerialTile, fileStem, loadDesignDoc, pdfResponse } from "@/lib/design-docs";
import { renderPlanPdf } from "@/lib/design-pdf";

/** Download design: the roof plan with panels, strings, markers and cable runs. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const doc = await asUser((tx) => loadDesignDoc(tx, id));
  if (!doc) return new Response("No saved solar design", { status: 404 });
  const buf = await renderPlanPdf(doc, await aerialTile(doc.position));
  return pdfResponse(buf, `${fileStem(doc.contactName)}-design-v${doc.version}.pdf`);
}
