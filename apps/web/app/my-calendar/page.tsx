import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Logo } from "@/components/sidebar";
import { buttonVariants } from "@/components/ui/button";
import { disconnectCalendarAction } from "@/lib/actions/calendar";
import { asUser } from "@/lib/auth";
import { calendarConfigured } from "@/lib/calendar-sync";

export const metadata = { title: "My calendar" };
export const dynamic = "force-dynamic";

const NOTICES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Google Calendar connected. Your bookings for the next 90 days are being added now; new and moved bookings follow within a minute." },
  cancelled: { ok: false, text: "Not connected: the Google sign-in was cancelled." },
  expired: { ok: false, text: "That Google sign-in had expired. Please try again." },
  failed: { ok: false, text: "Google didn't accept the connection. Please try again." },
  "not-configured": { ok: false, text: "Google Calendar isn't set up on this server yet." },
};

/** Each person's own calendar connection: open to office staff and installers alike. */
export default async function MyCalendarPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const { row, role } = await asUser(
    async (tx, s) => ({ row: await tx.selectFrom("integrations").select(["status", "settings"]).where("provider", "=", "google_calendar").where("user_id", "=", s.userId).executeTakeFirst(), role: s.role }),
    ["admin", "office", "installer", "subcontractor"],
  );
  const n = NOTICES[google ?? ""];
  const email = (row?.settings as { email?: string | null } | undefined)?.email;
  return (
    <div className="min-h-dvh bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2.5 px-4 py-3.5">
          <span className="flex items-center gap-2.5 font-bold">
            <Logo size={28} /> GoInstall
          </span>
          {(role === "admin" || role === "office") && (
            <Link href="/schedule" className="text-sm font-semibold text-primary">
              Back to the Schedule
            </Link>
          )}
        </div>
      </div>
      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pt-8 pb-12">
        <h1 className="text-2xl font-bold">My calendar</h1>
        {n && (
          <p role="status" className={n.ok ? "rounded-md bg-success-tint px-4 py-3 text-sm font-semibold text-success-text" : "rounded-md bg-red-50 px-4 py-3 text-sm text-red-900"}>
            {n.text}
          </p>
        )}
        <section className="flex flex-col gap-4 rounded-2xl border bg-card p-6">
          <h2 className="text-lg font-bold">Google Calendar</h2>
          <p className="text-sm text-ink-3">The jobs you&apos;re booked on (yourself or with your team) appear in your Google Calendar, and move or disappear when the booking does. GoInstall only adds its own events; it doesn&apos;t read the rest of your calendar.</p>
          {row?.status === "connected" ? (
            <>
              <p className="text-sm">
                Connected{email ? (
                  <>
                    {" "}
                    to <strong>{email}</strong>
                  </>
                ) : null}
                .
              </p>
              <ActionForm action={disconnectCalendarAction}>
                <SubmitButton variant="outline" pendingText="Disconnecting…">
                  Disconnect
                </SubmitButton>
              </ActionForm>
            </>
          ) : calendarConfigured() ? (
            <>
              {row?.status === "error" && <p className="text-sm text-red-700">Google stopped accepting GoInstall&apos;s access. Connect again to keep your bookings in your calendar.</p>}
              <a href="/api/integrations/google-calendar/connect" className={buttonVariants({ className: "w-fit" })}>
                Connect Google Calendar
              </a>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Google Calendar isn&apos;t set up on this server yet (GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET).</p>
          )}
        </section>
      </main>
    </div>
  );
}
