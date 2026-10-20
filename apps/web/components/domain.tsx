import { CONTACT_STAGE_LABELS, stageLabel, type ContactStage, type ProjectStage } from "@goinstall/core";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PRODUCT_LABELS = { solar: "Solar", battery: "Battery", ev: "EV charger" } as const;
export type Product = keyof typeof PRODUCT_LABELS;
export const PRODUCTS = Object.keys(PRODUCT_LABELS) as Product[];

export function productLabel(p: Product) {
  return PRODUCT_LABELS[p];
}

const TAG_LABELS = { solar: "Solar", battery: "Battery", ev: "EV" } as const;

export function ProductTags({ products, className }: { products: readonly Product[]; className?: string }) {
  if (!products.length) return <span className="text-xs text-muted-foreground">No products</span>;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {products.map((p) => (
        <Badge key={p} variant="tag" title={PRODUCT_LABELS[p]}>
          {TAG_LABELS[p]}
        </Badge>
      ))}
    </span>
  );
}

/** Stage pill tint, text and dot colours from docs/design/DESIGN.md. */
const PILL = {
  grey: { pill: "bg-muted text-ink-2", dot: "bg-[#98a2b3]" },
  info: { pill: "bg-info-tint text-info-text", dot: "bg-info" },
  violet: { pill: "bg-violet-tint text-violet-text", dot: "bg-violet" },
  warn: { pill: "bg-warning-pill text-warning-text", dot: "bg-warning" },
  success: { pill: "bg-success-tint text-success-text", dot: "bg-success" },
  accent: { pill: "bg-accent-tint text-accent-strong", dot: "bg-primary" },
  delivery: { pill: "bg-muted text-ink-2", dot: "bg-muted-foreground" },
  lost: { pill: "bg-muted text-ink-3", dot: "bg-input" },
} as const;
type Tone = keyof typeof PILL;

const STAGE_TONE: Record<ProjectStage, Tone> = {
  enquiry: "grey",
  survey: "info",
  design: "violet",
  proposal_sent: "warn",
  accepted: "success",
  deposit_paid: "success",
  kit_ordered: "delivery",
  scheduled: "accent",
  complete: "delivery",
  lost: "lost",
};

const CONTACT_STAGE_TONE: Record<ContactStage, Tone> = {
  new_enquiry: "grey",
  survey: "info",
  design: "violet",
  proposal_sent: "warn",
  won: "success",
  lost: "lost",
};

export function stageDotClass(stage: ContactStage) {
  return PILL[CONTACT_STAGE_TONE[stage]].dot;
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold whitespace-nowrap", PILL[tone].pill)}>
      <span className={cn("size-1.5 rounded-full", PILL[tone].dot)} aria-hidden />
      {children}
    </span>
  );
}

export function StageChip({ stage }: { stage: ProjectStage }) {
  return <Pill tone={STAGE_TONE[stage]}>{stageLabel(stage)}</Pill>;
}

export function ContactStageChip({ stage }: { stage: ContactStage }) {
  return <Pill tone={CONTACT_STAGE_TONE[stage]}>{CONTACT_STAGE_LABELS[stage]}</Pill>;
}

/** Initials avatar; tone alternates so owners are easy to tell apart. */
export function Avatar({ name, size = "sm", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const blue = [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 2 === 1;
  const sizes = { sm: "size-6 text-[10.5px]", md: "size-[34px] text-[11.5px]", lg: "size-14 text-lg" };
  return (
    <span
      title={name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold", blue ? "bg-info-tint text-info-text" : "bg-accent-tint text-accent-strong", sizes[size], className)}
    >
      {initials}
    </span>
  );
}

export const SOURCES = ["Website", "Referral", "Google Ads", "Facebook", "Phone", "Show / event", "Other"];

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">{title}</h1>
        {description && <p className="text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-input p-6 text-center text-sm text-muted-foreground">{children}</p>;
}
