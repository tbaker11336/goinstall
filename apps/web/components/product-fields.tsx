"use client";

import { CATEGORY_LABELS, PRODUCT_CATEGORIES, SPEC_FIELDS, type ProductCategory, type SpecField } from "@goinstall/core";
import { useState } from "react";
import { Input, Select } from "@/components/ui/input";

const pounds = (p: number | null) => (p === null ? "" : (p / 100).toFixed(2));

export interface ProductFormValues {
  category: ProductCategory;
  name: string;
  make: string | null;
  model: string;
  sku: string | null;
  unit: string;
  sellPence: number | null;
  specs: Record<string, number | boolean | string>;
  /** Signed links to the current files, when there are any. */
  datasheet: { url: string | null } | null;
  photo: { url: string | null } | null;
}

function Labelled({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<"input">) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <Input id={id} {...props} />
    </div>
  );
}

function Spec({ prefix, f, value }: { prefix: string; f: SpecField; value: number | boolean | string | undefined }) {
  if (f.type === "boolean")
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${prefix}-spec-${f.key}`} className="text-[13px] text-ink-2">
          {f.label}
        </label>
        <Select id={`${prefix}-spec-${f.key}`} name={`spec_${f.key}`} defaultValue={value === undefined ? "" : value ? "yes" : "no"}>
          <option value="">—</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      </div>
    );
  return <Labelled id={`${prefix}-spec-${f.key}`} name={`spec_${f.key}`} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`} inputMode={f.type === "number" ? "decimal" : undefined} defaultValue={value === undefined ? "" : String(value)} />;
}

/**
 * A product's details. The datasheet values change with the category as you
 * pick it: the few that matter up front, the rest under "More datasheet
 * details". Categories with no calculations (mounting, cable, labour…) ask
 * for none. Datasheet PDF and photo appear on proposals.
 */
export function ProductFields({ prefix, p }: { prefix: string; p?: ProductFormValues }) {
  const [cat, setCat] = useState<ProductCategory>(p?.category ?? "panel");
  const fields = SPEC_FIELDS[cat] ?? [];
  const essential = fields.filter((f) => f.essential);
  const more = fields.filter((f) => !f.essential);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefix}-category`} className="text-[13px] font-semibold text-ink-2">
            Category
          </label>
          <Select id={`${prefix}-category`} name="category" value={cat} onChange={(e) => setCat(e.target.value as ProductCategory)}>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <Labelled id={`${prefix}-name`} name="name" label="Name on proposals" defaultValue={p?.name} required />
        <Labelled id={`${prefix}-sell`} name="sell_price" label="Sell price (£, ex VAT)" inputMode="decimal" defaultValue={pounds(p?.sellPence ?? null)} />
        <Labelled id={`${prefix}-make`} name="make" label="Make" defaultValue={p?.make ?? ""} />
        <Labelled id={`${prefix}-model`} name="model" label="Model" defaultValue={p?.model} required />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefix}-unit`} className="text-[13px] font-semibold text-ink-2">
            Sold per
          </label>
          <Select id={`${prefix}-unit`} name="unit" defaultValue={p?.unit ?? "each"}>
            {["each", "kit", "metre", "hour", "day"].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
        </div>
      </div>

      {essential.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink-2">{CATEGORY_LABELS[cat]} details</legend>
          <div className="grid gap-3 sm:grid-cols-4">
            {essential.map((f) => (
              <Spec key={`${cat}-${f.key}`} prefix={prefix} f={f} value={p?.category === cat ? p.specs[f.key] : undefined} />
            ))}
          </div>
        </fieldset>
      )}

      {/* Always there: it also holds your own product code. */}
      {(
        <details className="rounded-md border border-dashed px-3 py-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-primary">More details (optional)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            {more.map((f) => (
              <Spec key={`${cat}-${f.key}`} prefix={prefix} f={f} value={p?.category === cat ? p.specs[f.key] : undefined} />
            ))}
            <Labelled id={`${prefix}-sku`} name="sku" label="Your code" defaultValue={p?.sku ?? ""} />
          </div>
        </details>
      )}

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 text-[13px] font-semibold text-ink-2">Shown on proposals</legend>
        <FileField prefix={prefix} name="datasheet" label="Datasheet (PDF)" accept="application/pdf" current={p?.datasheet ?? null} />
        <FileField prefix={prefix} name="photo" label="Photo (JPEG, PNG or WebP)" accept="image/jpeg,image/png,image/webp" current={p?.photo ?? null} />
      </fieldset>
    </>
  );
}

function FileField({ prefix, name, label, accept, current }: { prefix: string; name: string; label: string; accept: string; current: { url: string | null } | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${prefix}-${name}`} className="text-[13px] text-ink-2">
        {current ? `Replace ${label.toLowerCase()}` : label}
      </label>
      <Input id={`${prefix}-${name}`} name={name} type="file" accept={accept} className="py-1.5" />
      {current && (
        <span className="flex items-center gap-3 text-xs text-ink-3">
          {current.url ? (
            <a href={current.url} target="_blank" rel="noopener" className="font-semibold text-primary underline">
              View current
            </a>
          ) : (
            "Attached"
          )}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name={`remove_${name}`} value="1" className="size-3.5" />
            Remove
          </label>
        </span>
      )}
    </div>
  );
}
