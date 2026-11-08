import { notFound, redirect } from "next/navigation";
import { xeroFake } from "@/lib/xero";

/** Development stand-in for Xero's sign-in: straight back with a code. */
export async function GET(request: Request) {
  if (!xeroFake()) notFound();
  const state = new URL(request.url).searchParams.get("state") ?? "";
  redirect(`/api/integrations/xero/callback?code=fake-code&state=${encodeURIComponent(state)}`);
}
