import { EmptyState, PageHeader } from "@/components/domain";
import { requireSession } from "@/lib/auth";

export const metadata = { title: "Schedule" };

export default async function SchedulePage() {
  await requireSession();
  return (
    <>
      <PageHeader title="Schedule" />
      <EmptyState>The team calendar for surveys and installs arrives in phase 5.</EmptyState>
    </>
  );
}
