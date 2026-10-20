import { notFound } from "next/navigation";
import { EmptyState } from "@/components/domain";
import { PROJECT_TABS } from "../tabs";

export default async function ProjectTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  const info = PROJECT_TABS.find((t) => t.slug === tab && t.slug);
  if (!info) notFound();
  return <EmptyState>The {info.label} tab arrives in phase {info.phase}.</EmptyState>;
}
