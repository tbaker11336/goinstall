import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Landing route for Supabase auth emails (sign-up confirmation, invites,
 * password reset). Handles both the PKCE `code` and `token_hash` link styles.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = url.searchParams.get("next");
  // Only allow same-site relative redirects.
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const supabase = await supabaseServer();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing code") };

  if (error) return NextResponse.redirect(new URL("/login?error=link", url));
  return NextResponse.redirect(new URL(destination, url));
}
