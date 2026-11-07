"use client";

import { CATEGORY_LABELS, formatPence, LINE_DISPLAY_LABELS, LINE_DISPLAYS, type LineDisplay, type ProductCategory } from "@goinstall/core";
import { Eye, EyeClosed, EyeOff, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface PickerProduct {
  id: string;
  name: string;
  make: string | null;
  model: string;
  category: ProductCategory;
  sellPence: number | null;
}

/**
 * Search the catalogue by name, make or model and pick a product for a
 * proposal line. Keyboard: arrows move, Enter picks, Escape closes.
 */
export function ProductPicker({ label, products, value, onPick, onClear }: { label: string; products: PickerProduct[]; value: PickerProduct | null; onPick: (p: PickerProduct) => void; onClear: () => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (words.length ? products.filter((p) => words.every((w) => `${p.name} ${p.make ?? ""} ${p.model} ${CATEGORY_LABELS[p.category]}`.toLowerCase().includes(w))) : products).slice(0, 8);
  const pick = (p: PickerProduct) => {
    onPick(p);
    setQ("");
    setOpen(false);
  };
  if (value)
    return (
      <div className="flex h-9 min-w-0 items-center gap-1 rounded-md border bg-surface-subtle px-2 text-sm" title={`${value.name} (${CATEGORY_LABELS[value.category]})`}>
        <span className="min-w-0 flex-1 truncate">{value.name}</span>
        <button type="button" onClick={onClear} aria-label={`${label}: remove ${value.name}`} className="rounded p-0.5 text-ink-3 hover:bg-muted hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
    );
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-2.5 left-2 size-4 text-ink-3" aria-hidden />
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        value={q}
        placeholder="Search products…"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && matches[active]) {
            e.preventDefault();
            pick(matches[active]!);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="h-9 w-full rounded-md border border-input bg-card pr-2 pl-7 text-sm"
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={`${label}: products`} className="absolute top-10 left-0 z-20 max-h-72 w-80 overflow-y-auto rounded-md border bg-card py-1 shadow-lg">
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-3">No products match. Add them in Settings › Products.</li>
          ) : (
            matches.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm", i === active && "bg-accent-tint")}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {CATEGORY_LABELS[p.category]}
                    {p.make || p.model ? ` · ${[p.make, p.model].filter(Boolean).join(" ")}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-ink-3">{p.sellPence === null ? "No price" : formatPence(p.sellPence)}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

const ICONS: Record<LineDisplay, typeof Eye> = { show: Eye, hide_price: EyeClosed, hide: EyeOff };

/** What the customer sees of a line, as an icon at the end of the row that opens a small menu. */
export function LineVisibility({ label, value, onChange }: { label: string; value: LineDisplay; onChange: (v: LineDisplay) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const Icon = ICONS[value];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${LINE_DISPLAY_LABELS[value]}`}
        title={`Customer sees: ${LINE_DISPLAY_LABELS[value]}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className={cn("grid size-9 place-items-center rounded-md hover:bg-muted", value !== "show" && "text-warning-text")}
      >
        <Icon className="size-4" />
      </button>
      {open && (
        <div role="menu" aria-label={label} className="absolute top-10 right-0 z-20 w-52 rounded-md border bg-card py-1 shadow-lg">
          <p className="px-3 pt-1 pb-1.5 text-xs font-semibold text-ink-3">Customer sees</p>
          {LINE_DISPLAYS.map((d) => {
            const I = ICONS[d];
            return (
              <button
                key={d}
                type="button"
                role="menuitemradio"
                aria-checked={value === d}
                onClick={() => {
                  onChange(d);
                  setOpen(false);
                }}
                className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted", value === d && "font-semibold text-accent-strong")}
              >
                <I className="size-4" aria-hidden /> {LINE_DISPLAY_LABELS[d]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
