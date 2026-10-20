import { CATEGORY_LABELS, formatPence, inStock, margin, PRODUCT_CATEGORIES, SPEC_FIELDS, type ProductCategory } from "@goinstall/core";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PriceFileImport } from "@/components/price-file-import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { removeOfferAction, saveOfferAction, saveProductAction, saveSupplierAction, setProductArchivedAction } from "@/lib/actions/catalogue";
import { asUser } from "@/lib/auth";
import { listCatalogue, type CatalogueProduct } from "@/lib/catalogue";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Products & suppliers" };

const pounds = (p: number | null) => (p === null ? "" : (p / 100).toFixed(2));

function LabelledInput({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<"input">) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      <Input id={id} {...props} />
    </div>
  );
}

function ProductFields({ prefix, p, category }: { prefix: string; p?: CatalogueProduct; category?: ProductCategory }) {
  const cat = p?.category ?? category ?? "panel";
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefix}-category`} className="text-[13px] font-semibold text-ink-2">
            Category
          </label>
          <Select id={`${prefix}-category`} name="category" defaultValue={cat}>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <LabelledInput id={`${prefix}-name`} name="name" label="Name on proposals" defaultValue={p?.name} required />
        <LabelledInput id={`${prefix}-sell`} name="sell_price" label="Sell price (£, ex VAT)" inputMode="decimal" defaultValue={pounds(p?.sellPence ?? null)} />
        <LabelledInput id={`${prefix}-make`} name="make" label="Make" defaultValue={p?.make ?? ""} />
        <LabelledInput id={`${prefix}-model`} name="model" label="Model" defaultValue={p?.model} required />
        <LabelledInput id={`${prefix}-sku`} name="sku" label="Your code (optional)" defaultValue={p?.sku ?? ""} />
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
      {(SPEC_FIELDS[cat]?.length ?? 0) > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-ink-2">Datasheet values used in designs (save after changing the category to see its fields)</legend>
          <div className="grid gap-3 sm:grid-cols-4">
            {SPEC_FIELDS[cat]!.map((f) =>
              f.type === "boolean" ? (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <label htmlFor={`${prefix}-spec-${f.key}`} className="text-[13px] text-ink-2">
                    {f.label}
                  </label>
                  <Select id={`${prefix}-spec-${f.key}`} name={`spec_${f.key}`} defaultValue={p?.specs[f.key] === undefined ? "" : p.specs[f.key] ? "yes" : "no"}>
                    <option value="">—</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                </div>
              ) : (
                <LabelledInput
                  key={f.key}
                  id={`${prefix}-spec-${f.key}`}
                  name={`spec_${f.key}`}
                  label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`}
                  inputMode={f.type === "number" ? "decimal" : undefined}
                  defaultValue={p?.specs[f.key] === undefined ? "" : String(p.specs[f.key])}
                />
              ),
            )}
          </div>
        </fieldset>
      )}
    </>
  );
}

export default async function ProductsSettingsPage() {
  const { products, suppliers, imports } = await asUser(
    async (tx) => {
      const [products, suppliers, imports] = await Promise.all([
        listCatalogue(tx, { includeArchived: true }),
        tx.selectFrom("suppliers").selectAll().where("archived_at", "is", null).orderBy("name").execute(),
        tx.selectFrom("price_file_imports as i").leftJoin("suppliers as s", "s.id", "i.supplier_id").select(["i.supplier_id", "i.created_at", "s.name"]).orderBy("i.created_at", "desc").limit(20).execute(),
      ]);
      return { products, suppliers, imports };
    },
    ["admin"],
  );
  const lastImport = (supplierId: string) => imports.find((i) => i.supplier_id === supplierId);
  const active = products.filter((p) => !p.archived);
  const archived = products.filter((p) => p.archived);

  return (
    <>
      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Suppliers</CardTitle>
          <p className="text-sm text-ink-3">Upload each supplier&apos;s price file to compare prices and stock on the Kit tab. Live supplier connections are added once access is agreed.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-2">
            {suppliers.map((s) => {
              const last = lastImport(s.id);
              return (
                <li key={s.id}>
                  <details className="group relative">
                    <summary className="inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-semibold">
                      <span className={cn("size-1.5 rounded-full", last ? "bg-success" : "bg-[#98a2b3]")} aria-hidden />
                      {s.name} · {s.connection === "email" ? "email orders" : last ? `price file ${formatDate(last.created_at, { day: "numeric", month: "short" })}` : "no price file yet"}
                    </summary>
                    <ActionForm action={saveSupplierAction.bind(null, s.id)} className="absolute z-10 mt-2 flex w-80 flex-col gap-3 rounded-lg border bg-card p-4 shadow-[0_4px_12px_rgba(16,24,40,0.12)]">
                      <SupplierFields prefix={`s-${s.id}`} s={s} />
                      <div>
                        <SubmitButton size="sm">Save supplier</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                </li>
              );
            })}
            <li>
              <details className="group relative">
                <summary className="inline-flex cursor-pointer items-center rounded-full border border-dashed border-input px-3 py-1.5 text-[13px] font-semibold text-primary">+ Add a supplier</summary>
                <ActionForm action={saveSupplierAction.bind(null, null)} className="absolute z-10 mt-2 flex w-80 flex-col gap-3 rounded-lg border bg-card p-4 shadow-[0_4px_12px_rgba(16,24,40,0.12)]" resetOnSuccess>
                  <SupplierFields prefix="new-s" />
                  <div>
                    <SubmitButton size="sm">Add supplier</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start">
          <CardTitle>Upload a price file or catalogue (CSV)</CardTitle>
          <p className="text-sm text-ink-3">Rows match existing products by supplier code, then make and model. New products are added.</p>
        </CardHeader>
        <CardContent>
          <PriceFileImport suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Products ({active.length})</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-subtle text-left text-[12.5px] text-ink-3">
              <tr className="border-y">
                <th scope="col" className="px-5 py-2.5 font-semibold">Product</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Category</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Best supplier</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Cost</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Sell</th>
                <th scope="col" className="px-5 py-2.5 text-right font-semibold">Margin</th>
              </tr>
            </thead>
            {active.map((p) => {
              const m = p.sellPence && p.best?.costPence != null ? margin(p.sellPence, p.best.costPence) : null;
              return (
                <tbody key={p.id} className="border-b border-divider">
                  <tr>
                    <td className="px-5 pt-3 pb-1">
                      <span className="font-semibold">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">{[p.make, p.model].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="px-3 pt-3 pb-1">{CATEGORY_LABELS[p.category]}</td>
                    <td className="px-3 pt-3 pb-1">
                      {p.best ? (
                        <>
                          {p.best.supplierName}
                          <span className={cn("block text-xs", inStock(p.best) ? "text-success-text" : "text-warning-text")}>
                            {inStock(p.best) ? "In stock" : p.best.leadTimeDays ? `${p.best.leadTimeDays} days` : "Out of stock"}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No supplier price</span>
                      )}
                    </td>
                    <td className="px-3 pt-3 pb-1 text-right tabular-nums">{formatPence(p.best?.costPence)}</td>
                    <td className="px-3 pt-3 pb-1 text-right tabular-nums">{formatPence(p.sellPence)}</td>
                    <td className={cn("px-5 pt-3 pb-1 text-right tabular-nums", m !== null && m < 0.15 && "text-warning-text")}>{m === null ? "—" : `${(m * 100).toFixed(1)}%`}</td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="px-5 pb-3">
                      <details>
                        <summary className="cursor-pointer text-[13px] font-semibold text-primary">Edit product and supplier prices</summary>
                        <div className="mt-3 flex flex-col gap-5 rounded-[10px] border bg-surface-subtle p-4">
                          <ActionForm action={saveProductAction.bind(null, p.id)} className="flex flex-col gap-4">
                            <ProductFields prefix={`p-${p.id}`} p={p} />
                            <div>
                              <SubmitButton size="sm">Save product</SubmitButton>
                            </div>
                          </ActionForm>
                          <div className="flex flex-col gap-2">
                            <h3 className="text-sm font-bold">Supplier prices</h3>
                            {p.offers.map((o) => (
                              <div key={o.id} className="flex flex-wrap items-center gap-3 text-sm">
                                <span className="w-32 font-semibold">{o.supplierName}</span>
                                <span className="tabular-nums">{formatPence(o.costPence)}</span>
                                <span className="text-ink-3">{o.stockQty !== null ? `${o.stockQty} in stock` : o.leadTimeDays ? `${o.leadTimeDays} days` : "stock not reported"}</span>
                                <span className="text-xs text-muted-foreground">
                                  {o.supplierSku ?? "no code"} · {o.source === "price_file" ? "price file" : o.source} {formatDate(o.pricedAt, { day: "numeric", month: "short" })}
                                </span>
                                <form
                                  action={async () => {
                                    "use server";
                                    await removeOfferAction(o.id);
                                  }}
                                >
                                  <Button type="submit" size="sm" variant="ghost" className="h-7 text-red-700">
                                    Remove
                                  </Button>
                                </form>
                              </div>
                            ))}
                            {suppliers.length > 0 && (
                              <ActionForm action={saveOfferAction.bind(null, p.id)} className="flex flex-wrap items-end gap-2" resetOnSuccess>
                                <div className="flex flex-col gap-1.5">
                                  <label htmlFor={`o-${p.id}-supplier`} className="text-[13px] font-semibold text-ink-2">
                                    Supplier
                                  </label>
                                  <Select id={`o-${p.id}-supplier`} name="supplier_id" required defaultValue="" className="w-auto">
                                    <option value="" disabled>
                                      Choose…
                                    </option>
                                    {suppliers.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name}
                                      </option>
                                    ))}
                                  </Select>
                                </div>
                                <div className="w-28">
                                  <LabelledInput id={`o-${p.id}-cost`} name="cost" label="Cost (£)" inputMode="decimal" />
                                </div>
                                <div className="w-24">
                                  <LabelledInput id={`o-${p.id}-stock`} name="stock" label="Stock" inputMode="numeric" />
                                </div>
                                <div className="w-28">
                                  <LabelledInput id={`o-${p.id}-lead`} name="lead_time_days" label="Lead time (days)" inputMode="numeric" />
                                </div>
                                <div className="w-36">
                                  <LabelledInput id={`o-${p.id}-sku`} name="supplier_sku" label="Supplier code" />
                                </div>
                                <SubmitButton size="sm" variant="outline">
                                  Save price
                                </SubmitButton>
                              </ActionForm>
                            )}
                          </div>
                          <form
                            action={async () => {
                              "use server";
                              await setProductArchivedAction(p.id, true);
                            }}
                          >
                            <Button type="submit" size="sm" variant="ghost" className="text-red-700">
                              Archive product
                            </Button>
                          </form>
                        </div>
                      </details>
                    </td>
                  </tr>
                </tbody>
              );
            })}
          </table>
        </div>
        <CardContent className="flex flex-col gap-3 pt-5">
          <details className="rounded-[10px] border border-dashed border-input">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-primary">Add a product</summary>
            <ActionForm action={saveProductAction.bind(null, null)} className="flex flex-col gap-4 border-t border-divider px-4 py-4" resetOnSuccess>
              <ProductFields prefix="new-p" />
              <div>
                <SubmitButton size="sm">Add product</SubmitButton>
              </div>
            </ActionForm>
          </details>
          {archived.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-ink-3">Archived products ({archived.length})</summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {archived.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3">
                    <span className="text-ink-3">{p.name}</span>
                    <form
                      action={async () => {
                        "use server";
                        await setProductArchivedAction(p.id, false);
                      }}
                    >
                      <Button type="submit" size="sm" variant="outline">
                        Restore
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function SupplierFields({ prefix, s }: { prefix: string; s?: { name: string; connection: string; order_email: string | null; account_number: string | null } }) {
  return (
    <>
      <LabelledInput id={`${prefix}-name`} name="name" label="Name" defaultValue={s?.name} required />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${prefix}-connection`} className="text-[13px] font-semibold text-ink-2">
          Prices come from
        </label>
        <Select id={`${prefix}-connection`} name="connection" defaultValue={s?.connection === "email" ? "email" : "price_file"}>
          <option value="price_file">A price file I upload</option>
          <option value="email">Entered by hand (email-only supplier)</option>
        </Select>
      </div>
      <LabelledInput id={`${prefix}-email`} name="order_email" label="Order email" type="email" defaultValue={s?.order_email ?? ""} />
      <LabelledInput id={`${prefix}-account`} name="account_number" label="Your account number" defaultValue={s?.account_number ?? ""} />
    </>
  );
}
