"use client";

import { useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { setKitSupplierAction, setPurchaseOrderStatusAction } from "@/lib/actions/kit";
import { cn } from "@/lib/utils";

/** A supplier's price for a kit line; choosing it overrides the default pick. */
export function SupplierCell({
  itemId,
  supplierId,
  chosen,
  isOverride,
  price,
  stock,
  inStock,
  label,
}: {
  itemId: string;
  supplierId: string;
  chosen: boolean;
  isOverride: boolean;
  price: string;
  stock: string;
  inStock: boolean;
  label: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={chosen}
      aria-label={`${label}: ${price}, ${stock}${chosen ? " (chosen)" : ""}`}
      title={chosen && isOverride ? "Chosen by you. Click again to go back to the cheapest in stock." : chosen ? "Cheapest in stock" : "Buy from this supplier"}
      onClick={() => start(async () => void (await setKitSupplierAction(itemId, chosen && isOverride ? null : supplierId)))}
      className={cn(
        "flex w-full flex-col items-start rounded-[9px] border border-transparent px-3.5 py-2 text-left hover:border-border focus-visible:outline-2 focus-visible:outline-ring",
        chosen && "border-primary bg-accent-tint hover:border-primary",
        pending && "opacity-60",
      )}
    >
      <span className="font-semibold">{price}</span>
      <span className={cn("text-[13px]", chosen ? "text-accent-strong" : "text-ink-3")}>
        {chosen && inStock ? "✓ " : ""}
        {stock}
      </span>
    </button>
  );
}

const NEXT: Record<string, { status: "confirmed" | "delivered" | "cancelled"; label: string }[]> = {
  draft: [{ status: "cancelled", label: "Cancel" }],
  sent: [
    { status: "confirmed", label: "Mark confirmed" },
    { status: "delivered", label: "Mark delivered" },
    { status: "cancelled", label: "Cancel" },
  ],
  confirmed: [
    { status: "delivered", label: "Mark delivered" },
    { status: "cancelled", label: "Cancel" },
  ],
};

export function PoStatusButtons({ poId, status }: { poId: string; status: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>({});
  const next = NEXT[status] ?? [];
  if (!next.length) return null;
  return (
    <div className="flex flex-col items-end">
      <div className="flex gap-2">
        {next.map((n) => (
          <Button key={n.status} size="sm" variant={n.status === "cancelled" ? "ghost" : "outline"} disabled={pending} onClick={() => start(async () => setState(await setPurchaseOrderStatusAction(poId, n.status)))}>
            {n.label}
          </Button>
        ))}
      </div>
      <FormMessage state={state} />
    </div>
  );
}
