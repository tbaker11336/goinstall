"use client";

import { guessMapping, IMPORT_FIELDS, mapImportRows, parseCsv, type ColumnMapping, formatPence, CATEGORY_LABELS } from "@goinstall/core";
import { Upload } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { importPriceFileAction } from "@/lib/actions/catalogue";

/** CSV upload with a column-mapping step and a preview before import (spec: Catalogue). */
export function PriceFileImport({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [supplierId, setSupplierId] = useState("");
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();

  const parsed = useMemo(() => (file ? parseCsv(file.csv) : []), [file]);
  const headers = parsed[0] ?? [];
  const preview = useMemo(() => mapImportRows(parsed.slice(1), mapping), [parsed, mapping]);

  async function choose(f: File | undefined) {
    setState({});
    if (!f) return setFile(null);
    if (f.size > 2_000_000) return setState({ error: "That file is too large (2 MB maximum). Split it, or export only the products you use." });
    const csv = await f.text();
    const rows = parseCsv(csv);
    if (rows.length < 2) return setState({ error: "That file has no data rows. Export it as CSV with a header row." });
    setFile({ name: f.name, csv });
    setMapping(guessMapping(rows[0]!));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="import-file" className="text-[13px] font-semibold text-ink-2">
            CSV file
          </label>
          <input id="import-file" type="file" accept=".csv,text/csv" onChange={(e) => choose(e.target.files?.[0])} className="text-sm file:mr-3 file:h-9 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:font-semibold file:text-ink-2" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="import-supplier" className="text-[13px] font-semibold text-ink-2">
            Prices from
          </label>
          <Select id="import-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="w-auto">
            <option value="">No supplier (catalogue only)</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {file && (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">Match the columns in {file.name}</legend>
            <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((f) => (
                <div key={f.key} className="flex items-center gap-2">
                  <label htmlFor={`map-${f.key}`} className="w-40 shrink-0 text-[13px] text-ink-2">
                    {f.label}
                    {f.required && " *"}
                  </label>
                  <Select
                    id={`map-${f.key}`}
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                    className="h-9 min-w-0 flex-1 text-[13px]"
                  >
                    <option value="">Not in file</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </fieldset>

          <div className="overflow-x-auto rounded-[10px] border">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="px-3.5 py-2.5 text-left text-[13px] text-ink-3">
                Preview: {preview.rows.length} rows ready{preview.errors.length ? `, ${preview.errors.length} will be skipped` : ""}
              </caption>
              <thead className="bg-surface-subtle text-left text-[12.5px] text-ink-3">
                <tr>
                  {["Line", "Product", "Category", "Supplier code", "Cost", "Sell", "Stock"].map((h) => (
                    <th key={h} scope="col" className="px-3.5 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 8).map((r) => (
                  <tr key={r.line} className="border-t border-divider">
                    <td className="px-3.5 py-2 text-muted-foreground">{r.line}</td>
                    <td className="px-3.5 py-2">
                      <span className="font-semibold">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">{[r.make, r.model].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="px-3.5 py-2">{CATEGORY_LABELS[r.category]}</td>
                    <td className="px-3.5 py-2">{r.supplierSku ?? "—"}</td>
                    <td className="px-3.5 py-2 tabular-nums">{formatPence(r.costPence)}</td>
                    <td className="px-3.5 py-2 tabular-nums">{formatPence(r.sellPence)}</td>
                    <td className="px-3.5 py-2">{r.stockQty ?? (r.leadTimeDays ? `${r.leadTimeDays} days` : "—")}</td>
                  </tr>
                ))}
                {preview.errors.slice(0, 5).map((e) => (
                  <tr key={`e${e.line}`} className="border-t border-divider bg-warning-tint text-warning-text">
                    <td className="px-3.5 py-2">{e.line}</td>
                    <td colSpan={6} className="px-3.5 py-2">
                      Skipped: {e.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <Button
              disabled={pending || !preview.rows.length}
              onClick={() =>
                start(async () => {
                  const result = await importPriceFileAction({ csv: file.csv, fileName: file.name, supplierId: supplierId || null, mapping });
                  setState(result);
                  if (!result.error) setFile(null);
                })
              }
            >
              <Upload aria-hidden /> {pending ? "Importing…" : `Import ${preview.rows.length} rows`}
            </Button>
          </div>
        </>
      )}
      <FormMessage state={state} />
    </div>
  );
}
