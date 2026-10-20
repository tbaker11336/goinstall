import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", {
  variants: {
    variant: {
      default: "bg-secondary text-secondary-foreground",
      outline: "border text-foreground",
      muted: "bg-muted text-muted-foreground",
      // Product tags: neutral, squarer than pills (DESIGN.md "Product tag").
      tag: "rounded-[6px] bg-muted px-2 text-ink-2",
      warning: "bg-warning-pill text-warning-text",
      danger: "bg-red-50 text-red-800",
      success: "bg-success-tint text-success-text",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
