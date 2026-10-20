import { CONTACT_STAGE_LABELS, stageLabel, type ContactStage, type ProjectStage } from "@goinstall/core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PRODUCT_LABELS = { solar: "Solar", battery: "Battery", ev: "EV charger" } as const;
export type Product = keyof typeof PRODUCT_LABELS;
export const PRODUCTS = Object.keys(PRODUCT_LABELS) as Product[];

export function productLabel(p: Product) {
  return PRODUCT_LABELS[p];
}

export function ProductTags({ products, className }: { products: readonly Product[]; className?: string }) {
  if (!products.length) return <span className="text-xs text-muted-foreground">No products</span>;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {products.map((p) => (
        <Badge key={p} variant={p}>
          {PRODUCT_LABELS[p]}
        </Badge>
      ))}
    </span>
  );
}

const STAGE_STYLES: Record<ProjectStage, string> = {
  enquiry: "bg-slate-100 text-slate-800",
  survey: "bg-blue-100 text-blue-900",
  design: "bg-indigo-100 text-indigo-900",
  proposal_sent: "bg-amber-100 text-amber-900",
  accepted: "bg-lime-100 text-lime-900",
  deposit_paid: "bg-emerald-100 text-emerald-900",
  kit_ordered: "bg-teal-100 text-teal-900",
  scheduled: "bg-cyan-100 text-cyan-900",
  complete: "bg-green-200 text-green-950",
  lost: "bg-red-100 text-red-900",
};

export function StageChip({ stage }: { stage: ProjectStage }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STAGE_STYLES[stage])}>{stageLabel(stage)}</span>;
}

const CONTACT_STAGE_STYLES: Record<ContactStage, string> = {
  new_enquiry: STAGE_STYLES.enquiry,
  survey: STAGE_STYLES.survey,
  design: STAGE_STYLES.design,
  proposal_sent: STAGE_STYLES.proposal_sent,
  won: STAGE_STYLES.deposit_paid,
  lost: STAGE_STYLES.lost,
};

export function ContactStageChip({ stage }: { stage: ContactStage }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", CONTACT_STAGE_STYLES[stage])}>
      {CONTACT_STAGE_LABELS[stage]}
    </span>
  );
}

export const SOURCES = ["Website", "Referral", "Google Ads", "Facebook", "Phone", "Show / event", "Other"];

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}
