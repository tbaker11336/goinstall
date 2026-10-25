import "server-only";
import { notFound } from "next/navigation";
import { requireSession } from "./auth";

/** GoInstall staff (not tenant admins): emails listed in PLATFORM_ADMIN_EMAILS. Anyone else gets a 404. */
export async function requirePlatformAdmin() {
  const session = await requireSession();
  const allowed = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(session.email.toLowerCase())) notFound();
  return session;
}
