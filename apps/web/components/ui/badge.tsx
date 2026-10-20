import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    variant: {
      default: "bg-secondary text-secondary-foreground",
      outline: "border text-foreground",
      muted: "bg-muted text-muted-foreground",
      solar: "bg-amber-100 text-amber-900",
      battery: "bg-violet-100 text-violet-900",
      ev: "bg-sky-100 text-sky-900",
      danger: "bg-red-100 text-red-900",
      success: "bg-emerald-100 text-emerald-900",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
