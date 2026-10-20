import { EmptyState, PageHeader } from "@/components/domain";
import { requireSession } from "@/lib/auth";

export const metadata = { title: "Proposals" };

export default async function ProposalsPage() {
  await requireSession();
  return (
    <>
      <PageHeader title="Proposals" />
      <EmptyState>Proposals, e-signature and deposits arrive in phase 4.</EmptyState>
    </>
  );
}
