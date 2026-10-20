import { z } from "zod";
import { asUser } from "@/lib/auth";
import { fileStem, loadDesignDoc, pdfResponse } from "@/lib/design-docs";
import { renderSldPdf } from "@/lib/design-pdf";

/** Download SLD: the single line diagram drawn from the design. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const doc = await asUser((tx) => loadDesignDoc(tx, id));
  if (!doc) return new Response("No saved solar design", { status: 404 });
  return pdfResponse(await renderSldPdf(doc), `${fileStem(doc.contactName)}-sld-v${doc.version}.pdf`);
}
