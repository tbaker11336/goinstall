import { redirect } from "next/navigation";

/** Paperwork moved to the Handover tab. */
export default async function PaperworkRedirect({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  redirect(`/projects/${id}/handover/paperwork/${itemId}`);
}
