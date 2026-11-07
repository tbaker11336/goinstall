import { z } from "zod";
import { asUser } from "@/lib/auth";
import { invoicePdf } from "@/lib/invoices";

/** The invoice PDF for staff (RLS: admin and office only). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const pdf = await asUser(async (tx, session) => {
    const seen = await tx.selectFrom("invoices").select("id").where("id", "=", id).executeTakeFirst();
    return seen ? invoicePdf(tx, session.companyId, id) : null;
  }).catch(() => null);
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(pdf.bytes, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.doc.number}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
