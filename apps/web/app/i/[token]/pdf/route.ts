import { withService } from "@goinstall/db";
import { hashPayToken } from "@/lib/completion";
import { db } from "@/lib/db";
import { invoicePdf } from "@/lib/invoices";

/** The customer's invoice PDF, from the private pay link. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return new Response("Not found", { status: 404 });
  const pdf = await withService(db(), async (tx) => {
    const inv = await tx.selectFrom("invoices").select(["id", "company_id"]).where("pay_token_hash", "=", hashPayToken(token)).where("status", "!=", "void").executeTakeFirst();
    return inv ? invoicePdf(tx, inv.company_id, inv.id) : null;
  });
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(pdf.bytes, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.doc.number}.pdf"`, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
  });
}
