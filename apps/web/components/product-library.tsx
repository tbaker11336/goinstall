"use client";

import { Check, Search } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { FormMessage, type FormState } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { addFromLibraryAction, searchLibraryAction, type LibraryHit } from "@/lib/actions/catalogue";

const spec = (v: number | undefined, unit: string) => (v === undefined ? "—" : `${v} ${unit}`);

/** Search the shared library and copy a product, with its datasheet values, into the catalogue. */
export function ProductLibrary() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ hits: LibraryHit[]; total: number } | null>(null);
  const [state, setState] = useState<FormState>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [, start] = useTransition();
  const latest = useRef(0);

  // Search a moment after typing stops; only the newest answer is shown.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResult(null);
      return;
    }
    const n = ++latest.current;
    const t = setTimeout(async () => {
      const r = await searchLibraryAction(q);
      if (n === latest.current) setResult(r);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function add(hit: LibraryHit) {
    setAdding(hit.id);
    setState({});
    start(async () => {
      const r = await addFromLibraryAction(hit.id);
      setAdding(null);
      setState(r);
      if (!r.error) setResult((cur) => (cur ? { ...cur, hits: cur.hits.map((h) => (h.id === hit.id ? { ...h, inCatalogue: true } : h)) } : cur));
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="library-search" className="text-[13px] font-semibold text-ink-2">
        Search panels by make, model or watts
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id="library-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Jinko 440 or JKM445"
          autoComplete="off"
          className="h-11 w-full rounded-md border border-input bg-card pr-3 pl-9 text-sm"
        />
      </div>
      <FormMessage state={state} />
      {result && (
        <div role="region" aria-label="Library results" aria-live="polite">
          <p className="mb-2 text-[13px] text-ink-3">
            {result.total === 0 ? "No panels match." : result.total > result.hits.length ? `Showing ${result.hits.length} of ${result.total.toLocaleString("en-GB")}: add more words to narrow it.` : `${result.total} found.`}
          </p>
          {result.hits.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-subtle text-left text-ink-3">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Panel</th>
                    <th className="px-3 py-2 text-right font-semibold">Wp</th>
                    <th className="px-3 py-2 text-right font-semibold">Voc</th>
                    <th className="px-3 py-2 text-right font-semibold">Isc</th>
                    <th className="px-3 py-2 text-right font-semibold">Size (mm)</th>
                    <th className="px-3 py-2">
                      <span className="sr-only">Add</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.hits.map((h) => (
                    <tr key={h.id} className="border-t border-divider">
                      <td className="px-3 py-2">
                        <span className="font-semibold">{h.make}</span> {h.model}
                      </td>
                      <td className="px-3 py-2 text-right">{h.specs.watts_peak}</td>
                      <td className="px-3 py-2 text-right">{spec(h.specs.voc, "V")}</td>
                      <td className="px-3 py-2 text-right">{spec(h.specs.isc, "A")}</td>
                      <td className="px-3 py-2 text-right">{h.specs.width_mm && h.specs.height_mm ? `${h.specs.height_mm} × ${h.specs.width_mm}` : "not listed"}</td>
                      <td className="px-3 py-2 text-right">
                        {h.inCatalogue ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-success">
                            <Check className="size-4" aria-hidden /> In catalogue
                          </span>
                        ) : (
                          <Button type="button" size="sm" variant="outline" disabled={adding !== null} onClick={() => add(h)} aria-label={`Add ${h.name}`}>
                            {adding === h.id ? "Adding…" : "Add"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Panel data: California Energy Commission PV module list, via the NREL System Advisor Model library{result?.hits[0]?.sourceVersion ? ` (version ${result.hits[0].sourceVersion})` : ""}. Check values against the manufacturer&rsquo;s datasheet before relying on them.
      </p>
    </div>
  );
}
