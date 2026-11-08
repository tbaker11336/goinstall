import { timingSafeEqual } from "node:crypto";
import { withService } from "@goinstall/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asUser, requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { storeXeroTokens, xeroAuth, type XeroSettings } from "@/lib/xero";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Back from Xero: check the state, swap the code for tokens, save the connection. */
export async function GET(request: Request) {
  const session = await requireSession(["admin"]);
  const url = new URL(request.url);
  const jar = await cookies();
  const saved = jar.get("xero_oauth")?.value ?? "";
  jar.delete({ name: "xero_oauth", path: "/api/integrations/xero" });
  const [state, companyId] = saved.split(".");
  if (url.searchParams.get("error")) redirect("/settings/integrations?xero=cancelled");
  if (!state || !companyId || companyId !== session.companyId || !same(state, url.searchParams.get("state") ?? "")) redirect("/settings/integrations?xero=expired");
  const code = url.searchParams.get("code");
  if (!code) redirect("/settings/integrations?xero=expired");

  let ok = true;
  try {
    const auth = xeroAuth();
    const tokens = await auth.exchangeCode(code);
    const tenants = await auth.tenants(tokens.accessToken);
    if (!tenants.length) redirect("/settings/integrations?xero=no-organisation");
    const id = await asUser(
      async (tx) => {
        const existing = await tx.selectFrom("integrations").select(["id", "settings"]).where("provider", "=", "xero").where("user_id", "is", null).executeTakeFirst();
        const prev = (existing?.settings ?? {}) as Partial<XeroSettings>;
        const keep = prev.tenantId && tenants.find((t) => t.tenantId === prev.tenantId);
        const t = keep || tenants[0]!;
        const settings: XeroSettings = {
          tenantId: t.tenantId,
          tenantName: t.tenantName,
          connectionId: t.connectionId,
          tenants,
          // A different organisation needs its accounts and tax rates chosen again.
          salesAccountCode: keep ? (prev.salesAccountCode ?? null) : null,
          taxTypes: keep ? (prev.taxTypes ?? {}) : {},
          paymentAccountId: keep ? (prev.paymentAccountId ?? null) : null,
          cardAccountId: keep ? (prev.cardAccountId ?? null) : null,
          invoiceStatus: prev.invoiceStatus ?? "AUTHORISED",
        };
        if (existing) {
          await tx.updateTable("integrations").set({ status: "connected", settings: JSON.stringify(settings) }).where("id", "=", existing.id).execute();
          return existing.id;
        }
        return (await tx.insertInto("integrations").values({ provider: "xero", user_id: null, status: "connected", settings: JSON.stringify(settings) }).returning("id").executeTakeFirstOrThrow()).id;
      },
      ["admin"],
    );
    await withService(db(), (tx) => storeXeroTokens(tx, id, session.companyId, tokens));
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // a redirect
    ok = false;
  }
  redirect(ok ? "/settings/integrations?xero=connected" : "/settings/integrations?xero=failed");
}
