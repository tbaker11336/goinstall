import { redirect } from "next/navigation";

/** The old Install & paperwork tab: bookings now live on Schedule. */
export default async function InstallRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/projects/${id}/schedule`);
}
