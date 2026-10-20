import { jobsFor } from "@/lib/app-jobs";
import { preflight, withAppUser } from "@/lib/app-auth";

export const OPTIONS = preflight;

/** The signed-in installer's jobs from a week ago to three weeks ahead, for offline use. */
export async function GET(request: Request) {
  return withAppUser(request, async (tx, session) => {
    const now = Date.now();
    return Response.json(await jobsFor(tx, session, { from: new Date(now - 7 * 86_400_000), to: new Date(now + 21 * 86_400_000) }));
  });
}
