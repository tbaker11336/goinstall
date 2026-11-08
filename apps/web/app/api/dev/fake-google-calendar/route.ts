import { notFound, redirect } from "next/navigation";
import { calendarFake } from "@/lib/calendar-sync";

/** Development stand-in for Google's sign-in. */
export async function GET(request: Request) {
  if (!calendarFake()) notFound();
  const state = new URL(request.url).searchParams.get("state") ?? "";
  redirect(`/api/integrations/google-calendar/callback?code=fake-code&state=${encodeURIComponent(state)}`);
}
