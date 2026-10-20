"use client";

import { evaluateEvDesign, formatPence, parseAmps, type CableRow, type DesignSettings } from "@goinstall/core";
import { Cable, Check, Info, MousePointer2, PlugZap, Undo2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/input";
import { saveEvDesignAction, type EvDesignPayload } from "@/lib/actions/ev-design";
import { cn, timeAgo } from "@/lib/utils";
import type { EvInitial } from "./ev-data";
import type { CatalogueOption } from "./solar-designer";

type Tool = "select" | "charger" | "supply" | "route";

export interface EvDesignerProps {
  projectId: string;
  initial: EvInitial;
  aerial: { url: string; widthM: number } | null;
  chargers: CatalogueOption[];
  rules: { cables: CableRow[] | null; settings: DesignSettings };
  survey: { mainFuse: string | null; phases: 1 | 3; earthing: string | null; chargerLocation: string | null; cableRunM: number | null; tethered: string | null };
  photos: { url: string; label: string }[];
  solarDesigned: boolean;
}

const EARTHING = ["TN-C-S (PME)", "TN-S", "TT"];

function toLocal(el: SVGGraphicsElement, clientX: number, clientY: number) {
  const ctm = el.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
}

export function EvDesigner(props: EvDesignerProps) {
  const router = useRouter();
  const methods = useMemo(() => [...new Set(props.rules.cables?.map((c) => c.method) ?? [])], [props.rules.cables]);
  const init = props.initial;
  const [d, setD] = useState<EvDesignPayload>(() => ({
    ...init,
    background: init.background === "aerial" && !props.aerial ? "plain" : init.background,
    chargerProductId: init.chargerProductId ?? props.chargers[0]?.id ?? null,
    mainFuseA: init.mainFuseA ?? parseAmps(props.survey.mainFuse),
    phases: init.version ? init.phases : props.survey.phases,
    earthing: init.earthing ?? (props.survey.earthing && props.survey.earthing !== "Not sure" ? props.survey.earthing : null),
    tethered: init.tethered ?? (props.survey.tethered ? /tethered/i.test(props.survey.tethered) : null),
    routeLengthM: init.routeLengthM ?? props.survey.cableRunM,
    chargerLabel: init.version ? init.chargerLabel : props.survey.chargerLocation ? `Charger · ${props.survey.chargerLocation}` : "Charger",
  }));
  const [tool, setTool] = useState<Tool>("select");
  const [photoIndex, setPhotoIndex] = useState(0);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; at: string | null; version: number | null; error?: string }>({ state: init.version ? "saved" : "idle", at: init.savedAt, version: init.version });
  const svgRef = useRef<SVGSVGElement>(null);
  const first = useRef(true);
  const set = <K extends keyof EvDesignPayload>(k: K, v: EvDesignPayload[K]) => setD((x) => ({ ...x, [k]: v }));

  const measured = d.background !== "photo";
  const charger = props.chargers.find((c) => c.id === d.chargerProductId) ?? null;
  const result = useMemo(
    () =>
      evaluateEvDesign({
        route: d.route,
        routeMethods: d.routeMethods,
        routeLengthM: d.routeLengthM,
        routeLengthMeasured: measured,
        charger: charger ? (charger.specs as { rated_a?: number; rated_kw?: number; phases?: number }) : null,
        mainFuseA: d.mainFuseA,
        existingDemandA: d.existingDemandA,
        rules: { cables: props.rules.cables, voltDropLimitPct: props.rules.settings.evVoltDropLimitPct ?? null, chargerDiversity: props.rules.settings.evChargerDiversity ?? null },
      }),
    [d, measured, charger, props.rules],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave((s) => ({ ...s, state: "saving" }));
    const t = setTimeout(async () => {
      const r = await saveEvDesignAction(props.projectId, { ...d, routeLengthMeasured: measured });
      if (r.error) setSave((s) => ({ ...s, state: "error", error: r.error }));
      else {
        setSave({ state: "saved", at: r.savedAt ?? null, version: r.version ?? null });
        router.refresh();
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [d, measured, props.projectId, router]);

  function onPlan(e: React.PointerEvent<SVGRectElement | SVGImageElement>) {
    if (!svgRef.current || tool === "select") return;
    const p = toLocal(svgRef.current, e.clientX, e.clientY);
    if (!p) return;
    if (tool === "charger") {
      setD((x) => ({ ...x, chargerPoint: p, route: x.route.length ? [...x.route.slice(0, -1), p] : x.route }));
      setTool(d.supplyPoint ? "route" : "supply");
    } else if (tool === "supply") {
      setD((x) => ({ ...x, supplyPoint: p, route: x.route.length ? [p, ...x.route.slice(1)] : x.route }));
      setTool(d.chargerPoint ? "route" : "charger");
    } else if (tool === "route") {
      setD((x) => {
        const start = x.route.length ? x.route : x.supplyPoint ? [x.supplyPoint] : [];
        const route = [...start, p];
        const routeMethods = route.slice(1).map((_, i) => x.routeMethods[i] ?? x.routeMethods[x.routeMethods.length - 1] ?? methods[0] ?? "");
        return { ...x, route, routeMethods };
      });
    }
  }

  function finishRoute() {
    if (!d.chargerPoint) return setTool("charger");
    setD((x) => {
      const start = x.route.length ? x.route : x.supplyPoint ? [x.supplyPoint] : [];
      const last = start[start.length - 1];
      const route = last && last.x === x.chargerPoint!.x && last.y === x.chargerPoint!.y ? start : [...start, x.chargerPoint!];
      return { ...x, route, routeMethods: route.slice(1).map((_, i) => x.routeMethods[i] ?? x.routeMethods[x.routeMethods.length - 1] ?? methods[0] ?? "") };
    });
    setTool("select");
  }

  const size = props.aerial && d.background === "aerial" ? props.aerial.widthM : d.background === "photo" ? 100 : 30;
  const viewBox = d.background === "photo" ? "0 0 100 75" : `${-size / 2} ${-size / 2} ${size} ${size}`;
  const k = size / 100; // marker scale
  const photo = props.photos[photoIndex] ?? null;
  const vdOk = result.voltDropPct !== null && result.voltDropLimitPct !== null && result.voltDropPct <= result.voltDropLimitPct;
  const savedLabel = save.state === "saving" ? "Saving…" : save.state === "error" ? `Not saved: ${save.error}` : save.at ? `Saved ${timeAgo(save.at)}` : "Not saved yet";

  const tools = [
    { key: "select", label: "Select", icon: MousePointer2 },
    { key: "charger", label: "Charger", icon: PlugZap },
    { key: "supply", label: "Supply", icon: Zap },
    { key: "route", label: "Cable route", icon: Cable },
  ] as const;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_380px]">
      <section aria-label="Site plan" className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-3" role="toolbar" aria-label="EV design tools">
          {tools.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={tool === t.key}
              onClick={() => setTool(t.key)}
              className={cn("inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-ink-2 hover:bg-muted", tool === t.key && "bg-accent-tint text-accent-strong hover:bg-accent-tint")}
            >
              <t.icon className="size-[18px]" strokeWidth={1.75} aria-hidden /> {t.label}
            </button>
          ))}
          {tool === "route" && (
            <>
              <button type="button" onClick={finishRoute} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white">
                Finish at charger
              </button>
              <button type="button" onClick={() => setD((x) => ({ ...x, route: x.route.slice(0, -1), routeMethods: x.routeMethods.slice(0, Math.max(0, x.route.length - 2)) }))} className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-ink-2 hover:bg-muted">
                <Undo2 className="size-4" aria-hidden /> Undo point
              </button>
            </>
          )}
          <label className="ml-auto inline-flex items-center gap-2 text-sm font-semibold text-ink-2">
            View
            <Select value={d.background} onChange={(e) => set("background", e.target.value as EvDesignPayload["background"])} className="h-10 w-auto">
              {props.aerial && <option value="aerial">Aerial</option>}
              <option value="plain">Plan</option>
              {props.photos.length > 0 && <option value="photo">Survey photo</option>}
            </Select>
          </label>
          {d.background === "photo" && props.photos.length > 1 && (
            <Select aria-label="Which photo" value={photoIndex} onChange={(e) => setPhotoIndex(Number(e.target.value))} className="h-10 w-auto">
              {props.photos.map((p, i) => (
                <option key={i} value={i}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="relative bg-[#dce5d2]">
          <div className="absolute top-4 left-4 z-10 flex max-w-[70%] flex-col gap-2">
            <label className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm font-semibold text-ink-2">
              <span className="size-3 rounded-[3px] border-2 border-foreground" aria-hidden />
              <span className="sr-only">Supply label</span>
              <input value={d.supplyLabel} onChange={(e) => set("supplyLabel", e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none" />
            </label>
            <label className="flex items-center gap-2 rounded-md border-2 border-primary bg-card px-3 py-1.5 text-sm font-semibold text-accent-strong">
              <span className="size-2.5 rounded-full bg-primary" aria-hidden />
              <span className="sr-only">Charger label</span>
              <input value={d.chargerLabel} onChange={(e) => set("chargerLabel", e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none" />
            </label>
            {result.lengthM !== null && (
              <span className="rounded-md border border-warning-border bg-warning-tint px-3 py-1.5 text-sm font-semibold text-warning-text">
                Cable route · {result.lengthM} m{d.routeMethods[0] ? `, ${[...new Set(d.routeMethods)].join(" / ")}` : ""}
              </span>
            )}
          </div>
          <svg ref={svgRef} viewBox={viewBox} className={cn("block w-full touch-none select-none", d.background === "photo" ? "aspect-[4/3]" : "aspect-square max-h-[720px]", tool !== "select" && "cursor-crosshair")} role="img" aria-label="Site plan with supply, charger and cable route">
            <rect x={-500} y={-500} width={1000} height={1000} fill="#dce5d2" onPointerDown={onPlan} />
            {d.background === "aerial" && props.aerial && <image href={props.aerial.url} x={-size / 2} y={-size / 2} width={size} height={size} onPointerDown={onPlan} />}
            {d.background === "photo" && photo && <image href={photo.url} x={0} y={0} width={100} height={75} preserveAspectRatio="xMidYMid slice" onPointerDown={onPlan} />}
            {d.background === "plain" && (
              <g opacity={0.35} pointerEvents="none">
                {Array.from({ length: 31 }, (_, i) => i - 15).map((i) => (
                  <g key={i}>
                    <line x1={i} y1={-15} x2={i} y2={15} stroke="#98a2b3" strokeWidth={0.02} />
                    <line x1={-15} y1={i} x2={15} y2={i} stroke="#98a2b3" strokeWidth={0.02} />
                  </g>
                ))}
              </g>
            )}
            {d.route.length > 1 && (
              <polyline points={d.route.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#DC6803" strokeWidth={0.5 * k} strokeLinejoin="round" strokeDasharray={`${1.2 * k} ${0.6 * k}`} pointerEvents="none" />
            )}
            {d.route.slice(1, -1).map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={0.5 * k} fill="#DC6803" pointerEvents="none" />
            ))}
            {d.supplyPoint && (
              <g transform={`translate(${d.supplyPoint.x} ${d.supplyPoint.y})`} pointerEvents="none">
                <rect x={-2.2 * k} y={-2.2 * k} width={4.4 * k} height={4.4 * k} rx={0.8 * k} fill="#fff" stroke="#101828" strokeWidth={0.35 * k} />
                {[-1, -0.35, 0.35, 1].map((x) => (
                  <line key={x} x1={x * k} y1={-1.1 * k} x2={x * k} y2={1.1 * k} stroke="#101828" strokeWidth={0.3 * k} />
                ))}
              </g>
            )}
            {d.chargerPoint && (
              <g transform={`translate(${d.chargerPoint.x} ${d.chargerPoint.y})`} pointerEvents="none">
                <circle r={2.6 * k} fill="#0B7A62" stroke="#fff" strokeWidth={0.4 * k} />
                <path d={`M${0.3 * k} ${-1.6 * k} L${-1 * k} ${0.3 * k} H${0} L${-0.3 * k} ${1.6 * k} L${1 * k} ${-0.3 * k} H${0} Z`} fill="#fff" />
              </g>
            )}
          </svg>
          {tool !== "select" && (
            <p role="status" className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-white">
              {tool === "charger" ? "Click where the charger goes" : tool === "supply" ? "Click the consumer unit or supply point" : "Click along the cable route, then Finish at charger"}
            </p>
          )}
          {!measured && <p className="absolute right-4 bottom-4 rounded-md bg-card px-3 py-1.5 text-xs font-semibold text-ink-3">Photos aren&apos;t to scale: enter the route length</p>}
        </div>
      </section>

      <div className="flex flex-col gap-5">
        <p className="flex items-center gap-1.5 text-[13px] text-ink-3" role="status" aria-live="polite">
          {save.state === "saved" && <Check className="size-4 text-success" aria-hidden />}
          {savedLabel}
          {save.version && <span className="text-muted-foreground">· version {save.version}</span>}
        </p>

        <section aria-labelledby="ev-charger" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
          <h2 id="ev-charger" className="text-[17px] font-bold">
            Charger
          </h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ev-model" className="text-[13px] font-semibold text-ink-2">
              Model
            </label>
            {props.chargers.length ? (
              <Select id="ev-model" value={d.chargerProductId ?? ""} onChange={(e) => set("chargerProductId", e.target.value || null)} className="h-11">
                {props.chargers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="rounded-md border border-dashed border-input px-3 py-2 text-[13px] text-muted-foreground">Add chargers in Settings › Products</p>
            )}
            {charger && (
              <span className="text-[13px] text-muted-foreground">
                {[charger.best?.costPence != null ? formatPence(charger.best.costPence) : null, charger.best ? (charger.best.inStock ? `in stock at ${charger.best.supplierName}` : `from ${charger.best.supplierName}`) : null, result.chargerA ? `${result.chargerA} A` : null].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          <Segmented label="Mounting" value={d.mounting} options={[["wall", "Wall"], ["post", "Post"]]} onChange={(v) => set("mounting", v as "wall" | "post")} />
          <Segmented label="Cable" value={d.tethered === null ? "" : d.tethered ? "tethered" : "socket"} options={[["tethered", "Tethered"], ["socket", "Socket"]]} onChange={(v) => set("tethered", v === "tethered")} />
        </section>

        <section aria-labelledby="ev-supply" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
          <h2 id="ev-supply" className="text-[17px] font-bold">
            Supply and load
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            <NumberField label="Main fuse (A)" value={d.mainFuseA} onChange={(v) => set("mainFuseA", v === null ? null : Math.round(v))} />
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">
              Phases
              <Select value={d.phases} onChange={(e) => set("phases", Number(e.target.value) as 1 | 3)} className="h-10">
                <option value={1}>Single phase</option>
                <option value={3}>Three phase</option>
              </Select>
            </label>
            <NumberField label="Existing max demand (A)" value={d.existingDemandA} onChange={(v) => set("existingDemandA", v)} hint="Assessed by your method" />
          </div>
          <Row label="Max demand with charger" value={result.demandA !== null ? `${result.demandA} A · ${result.loadManagementNeeded ? "over the fuse" : "OK"}` : "—"} tone={result.demandA === null ? undefined : result.loadManagementNeeded ? "warn" : "ok"} />
          <Row label="Load management" value={result.loadManagementNeeded === null ? "—" : result.loadManagementNeeded ? "Needed" : "Not needed"} />
          {result.fuseUpgradeWarning && <p className="text-[13px] font-semibold text-warning-text">The main fuse may need upgrading: ask the DNO.</p>}
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">
              Earthing
              <Select value={d.earthing ?? ""} onChange={(e) => set("earthing", e.target.value || null)} className="h-10">
                <option value="">Not known yet</option>
                {EARTHING.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">
              Protection method
              <input value={d.protection ?? ""} onChange={(e) => set("protection", e.target.value || null)} placeholder="e.g. charger PEN protection" className="h-10 rounded-md border border-input px-3 text-sm font-normal" />
            </label>
          </div>
        </section>

        <section aria-labelledby="ev-cable" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
          <h2 id="ev-cable" className="text-[17px] font-bold">
            Cable
          </h2>
          {measured ? (
            <Row label="Route" value={result.lengthM !== null ? `${result.lengthM} m · measured` : "Draw the route"} />
          ) : (
            <NumberField label="Route length (m)" value={d.routeLengthM} onChange={(v) => set("routeLengthM", v)} />
          )}
          {(d.routeMethods.length ? d.routeMethods : [d.routeMethods[0] ?? ""]).map((m, i) => (
            <label key={i} className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">
              {d.routeMethods.length > 1 ? `Part ${i + 1} installed` : "Installed"}
              {methods.length ? (
                <Select
                  value={m}
                  onChange={(e) => setD((x) => {
                    const next = [...(x.routeMethods.length ? x.routeMethods : [""])];
                    next[i] = e.target.value;
                    return { ...x, routeMethods: next };
                  })}
                  className="h-10"
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {methods.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              ) : (
                <span className="text-[13px] font-normal text-muted-foreground">Upload your cable table to choose methods.</span>
              )}
            </label>
          ))}
          <Row label="Cable size" value={result.cableSizeMm2 !== null ? `${result.cableSizeMm2} mm² · auto` : "—"} />
          <Row label="Volt drop" value={result.voltDropPct !== null ? `${result.voltDropPct}% · ${vdOk ? "within limit" : "over limit"}` : "—"} tone={result.voltDropPct === null ? undefined : vdOk ? "ok" : "warn"} />
        </section>

        {props.solarDesigned && (
          <section className="flex items-center justify-between gap-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="font-bold">Charge from surplus solar</h2>
              <p className="text-[13px] text-ink-3">Uses the solar design for this project.</p>
            </div>
            <button type="button" role="switch" aria-checked={d.solarDivert} aria-label="Charge from surplus solar" onClick={() => set("solarDivert", !d.solarDivert)} className={cn("relative h-7 w-12 rounded-full transition-colors", d.solarDivert ? "bg-primary" : "bg-input")}>
              <span className={cn("absolute top-0.5 left-0.5 size-6 rounded-full bg-white transition-transform", d.solarDivert && "translate-x-5")} />
            </button>
          </section>
        )}

        <section className="flex gap-3 rounded-lg border border-info/30 bg-info-tint p-5">
          <Info className="size-5 shrink-0 text-info-text" aria-hidden />
          <div>
            <h2 className="font-bold text-info-text">DNO notification needed</h2>
            <p className="text-sm text-info-text">Every charger install is notified to the DNO. It joins the paperwork list, pre-filled from this design, when paperwork arrives.</p>
          </div>
        </section>

        {result.notes.length > 0 && (
          <section aria-labelledby="ev-needs" className="flex flex-col gap-2 rounded-lg border border-info/30 bg-info-tint p-5">
            <h2 id="ev-needs" className="text-sm font-bold text-info-text">
              To finish the checks
            </h2>
            <ul className="list-disc pl-5 text-[13px] text-info-text">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {props.rules.settings.evVoltDropLimitPct == null && <li>Set the EV volt drop limit in Settings › Design rules.</li>}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-divider py-2 text-sm last:border-0">
      <span className="text-ink-3">{label}</span>
      <span className={cn("text-right font-semibold", tone === "ok" && "text-success-text", tone === "warn" && "text-warning-text")}>
        {tone === "ok" && <Check className="mr-1 inline size-4" aria-hidden />}
        {value}
      </span>
    </div>
  );
}

function NumberField({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (v: number | null) => void; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
        className="h-10 rounded-md border border-input px-3 text-sm font-normal text-foreground"
      />
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2" id={`seg-${label}`}>
        {label}
      </span>
      <div role="group" aria-labelledby={`seg-${label}`} className="flex rounded-[9px] bg-divider p-[3px]">
        {options.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={cn("h-9 flex-1 rounded-[7px] text-sm font-semibold text-ink-3", value === v && "bg-card text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.1)]")}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
