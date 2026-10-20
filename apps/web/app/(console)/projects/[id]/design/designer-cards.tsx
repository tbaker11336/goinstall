"use client";

import { CABLE_KINDS, CABLE_LABELS, cableLength, cableTotals, distance, MARKER_KINDS, MARKER_LABELS, type CableKind, type MarkerKind, type SiteMarkup, type StringCheck } from "@goinstall/core";
import { Trash2 } from "lucide-react";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CABLE_COLOURS, MARKER_COLOURS, stringColour } from "./plan-style";

export type PlanItem = { type: "marker" | "cable" | "measurement"; id: string } | null;

const smallButton = "inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-3 text-[13px] font-semibold text-ink-2 hover:bg-surface-subtle";

export function StringsCard({
  wired,
  auto,
  check,
  mpptCount,
  onMppt,
  onAutoAssign,
  onClear,
  onWireByHand,
}: {
  wired: { n: number; panels: number; mppt: number }[];
  auto: number[] | null;
  check: StringCheck | null;
  mpptCount: number | null;
  onMppt: (n: number, mppt: number) => void;
  onAutoAssign: () => void;
  onClear: () => void;
  onWireByHand: () => void;
}) {
  const inputs = Array.from({ length: Math.max(mpptCount ?? 4, ...wired.map((s) => s.mppt)) }, (_, i) => i + 1);
  return (
    <section aria-labelledby="strings-card" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id="strings-card" className="text-[17px] font-bold">
          Strings
        </h2>
        <span className="text-[13px] font-semibold text-ink-3">{wired.length ? "Wired by hand" : "Automatic"}</span>
      </div>
      {wired.length ? (
        <ul className="flex flex-col divide-y divide-divider">
          {wired.map((s) => {
            const c = check?.strings.find((x) => x.n === s.n);
            return (
              <li key={s.n} className="flex flex-col gap-1 py-2">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="size-3 rounded-[3px]" style={{ background: stringColour(s.n) }} />
                  <span className="text-sm font-semibold">String {s.n}</span>
                  <span className="text-[13px] text-ink-3">{s.panels} panels</span>
                  <label className="ml-auto flex items-center gap-1.5 text-[13px] text-ink-3">
                    MPPT
                    <Select aria-label={`MPPT input for string ${s.n}`} value={String(s.mppt)} onChange={(e) => onMppt(s.n, Number(e.target.value))} className="h-8 w-16 px-2 text-[13px]">
                      {inputs.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                {c && (c.vocColdV !== null || c.vmpV !== null) && (
                  <p className="text-xs text-muted-foreground">
                    {c.vocColdV !== null && `Voc cold ${Math.round(c.vocColdV)} V`}
                    {c.vocColdV !== null && c.vmpV !== null && " · "}
                    {c.vmpV !== null && `Vmp ${Math.round(c.vmpV)} V`}
                  </p>
                )}
                {c?.issues.map((i) => (
                  <p key={i} className="text-xs font-medium text-red-700">
                    {i}
                  </p>
                ))}
              </li>
            );
          })}
          {check?.mppts.flatMap((m) => m.issues.map((i) => (
            <li key={`${m.mppt}${i}`} className="py-2 text-xs font-medium text-red-700">
              MPPT {m.mppt}: {i}
            </li>
          )))}
        </ul>
      ) : (
        <p className="text-[13px] text-ink-3">{auto?.length ? `Split automatically: ${auto.map((n, i) => `string ${i + 1} ${n} panels`).join(", ")}.` : "Strings are worked out once a panel and inverter with datasheet values are chosen."}</p>
      )}
      {check?.ok && <p className="text-[13px] font-medium text-success">All strings within the inverter&rsquo;s limits.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onWireByHand} className={smallButton}>
          Wire by hand
        </button>
        <button type="button" onClick={onAutoAssign} className={smallButton}>
          Auto-assign
        </button>
        {wired.length > 0 && (
          <button type="button" onClick={onClear} className={smallButton}>
            Clear wiring
          </button>
        )}
      </div>
    </section>
  );
}

export function SitePlanCard({
  markup,
  selected,
  onSelect,
  onChange,
}: {
  markup: SiteMarkup;
  selected: PlanItem;
  onSelect: (item: PlanItem) => void;
  onChange: (fn: (m: SiteMarkup) => SiteMarkup) => void;
}) {
  const empty = !markup.markers.length && !markup.cables.length && !markup.measurements.length;
  const totals = cableTotals(markup.cables);
  const isSel = (type: NonNullable<PlanItem>["type"], id: string) => selected?.type === type && selected.id === id;
  const remove = (type: NonNullable<PlanItem>["type"], id: string) => {
    onChange((m) => ({
      markers: type === "marker" ? m.markers.filter((x) => x.id !== id) : m.markers,
      cables: type === "cable" ? m.cables.filter((x) => x.id !== id) : m.cables,
      measurements: type === "measurement" ? m.measurements.filter((x) => x.id !== id) : m.measurements,
    }));
    if (isSel(type, id)) onSelect(null);
  };
  return (
    <section aria-labelledby="site-plan" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
      <h2 id="site-plan" className="text-[17px] font-bold">
        Site plan
      </h2>
      {empty && <p className="text-[13px] text-ink-3">Use Mark to place the meter box, distribution board, inverter, battery, EV charger, scaffold or a note; Cable to draw routes; Measure for distances.</p>}

      {markup.markers.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Markers">
          {markup.markers.map((m) => (
            <li key={m.id} className={cn("flex flex-col gap-1.5 rounded-md border p-2.5", isSel("marker", m.id) && "border-primary")}>
              <div className="flex items-center gap-2">
                <span aria-hidden className="size-3 rounded-full" style={{ background: MARKER_COLOURS[m.kind] }} />
                <label className="sr-only" htmlFor={`mk-${m.id}`}>
                  Marker type
                </label>
                <Select
                  id={`mk-${m.id}`}
                  value={m.kind}
                  onFocus={() => onSelect({ type: "marker", id: m.id })}
                  onChange={(e) => onChange((x) => ({ ...x, markers: x.markers.map((y) => (y.id === m.id ? { ...y, kind: e.target.value as MarkerKind } : y)) }))}
                  className="h-8 flex-1 px-2 text-[13px]"
                >
                  {MARKER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {MARKER_LABELS[k]}
                    </option>
                  ))}
                </Select>
                <button type="button" aria-label={`Remove ${MARKER_LABELS[m.kind]}`} onClick={() => remove("marker", m.id)} className="rounded-md p-1.5 text-ink-3 hover:bg-muted">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              <label className="sr-only" htmlFor={`mn-${m.id}`}>
                {MARKER_LABELS[m.kind]} note
              </label>
              <input
                id={`mn-${m.id}`}
                value={m.note}
                maxLength={300}
                placeholder={m.kind === "note" ? "Note text" : "Note (optional)"}
                autoFocus={isSel("marker", m.id) && m.kind === "note" && !m.note}
                onFocus={() => onSelect({ type: "marker", id: m.id })}
                onChange={(e) => onChange((x) => ({ ...x, markers: x.markers.map((y) => (y.id === m.id ? { ...y, note: e.target.value } : y)) }))}
                className="h-8 rounded-md border border-input px-2 text-[13px]"
              />
            </li>
          ))}
        </ul>
      )}

      {markup.cables.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Cables">
          {markup.cables.map((c, i) => (
            <li key={c.id} className={cn("flex flex-col gap-1.5 rounded-md border p-2.5", isSel("cable", c.id) && "border-primary")}>
              <div className="flex items-center gap-2">
                <span aria-hidden className="h-1 w-4 rounded" style={{ background: CABLE_COLOURS[c.kind] }} />
                <label className="sr-only" htmlFor={`ck-${c.id}`}>
                  Cable {i + 1} type
                </label>
                <Select
                  id={`ck-${c.id}`}
                  value={c.kind}
                  onFocus={() => onSelect({ type: "cable", id: c.id })}
                  onChange={(e) => onChange((x) => ({ ...x, cables: x.cables.map((y) => (y.id === c.id ? { ...y, kind: e.target.value as CableKind } : y)) }))}
                  className="h-8 flex-1 px-2 text-[13px]"
                >
                  {CABLE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CABLE_LABELS[k]}
                    </option>
                  ))}
                </Select>
                <span className="stat text-[13px] font-semibold">{cableLength(c)} m</span>
                <button type="button" aria-label={`Remove cable ${i + 1}`} onClick={() => remove("cable", c.id)} className="rounded-md p-1.5 text-ink-3 hover:bg-muted">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-ink-3">
                Extra (drops, loops)
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={0.5}
                  value={c.extraM}
                  onFocus={() => onSelect({ type: "cable", id: c.id })}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 0 && v <= 200) onChange((x) => ({ ...x, cables: x.cables.map((y) => (y.id === c.id ? { ...y, extraM: v } : y)) }));
                  }}
                  className="h-8 w-20 rounded-md border border-input px-2 text-[13px] text-foreground"
                />
                m
              </label>
            </li>
          ))}
        </ul>
      )}
      {totals.length > 0 && (
        <p className="text-[13px] text-ink-3">
          Cable to order: {totals.map((t) => `${CABLE_LABELS[t.kind]} ${t.lengthM} m`).join(" · ")}
        </p>
      )}

      {markup.measurements.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Measurements">
          {markup.measurements.map((m, i) => (
            <li key={m.id} className={cn("flex items-center justify-between rounded-md px-2 py-1 text-[13px]", isSel("measurement", m.id) && "bg-accent-tint")}>
              <button type="button" onClick={() => onSelect({ type: "measurement", id: m.id })} className="text-left">
                Measurement {i + 1}: <span className="stat font-semibold">{Math.round(distance(m.a, m.b) * 100) / 100} m</span>
              </button>
              <button type="button" aria-label={`Remove measurement ${i + 1}`} onClick={() => remove("measurement", m.id)} className="rounded-md p-1.5 text-ink-3 hover:bg-muted">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {markup.measurements.length > 0 && <p className="text-xs text-muted-foreground">Distances are on the ground plan; slopes are longer.</p>}
    </section>
  );
}
