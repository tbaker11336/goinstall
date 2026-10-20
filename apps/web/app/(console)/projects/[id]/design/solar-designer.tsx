"use client";

import {
  autoFill,
  evaluateSolarDesign,
  formatPence,
  matchInverter,
  rectFits,
  type DesignSettings,
  type InverterSpecs,
  type McsYieldRow,
  type McsZoneRow,
  type PanelSpecs,
  type SelfConsumptionRow,
} from "@goinstall/core";
import { AlertTriangle, Check, Grid2x2, Images, Minus, MousePointer2, OctagonX, Plus, Sparkles, Triangle, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/input";
import { saveSolarDesignAction, type SolarDesignPayload } from "@/lib/actions/design";
import { cn, timeAgo } from "@/lib/utils";

type Segment = SolarDesignPayload["segments"][number];
type Tool = "select" | "panels" | "obstruction" | "draw";

export interface CatalogueOption {
  id: string;
  name: string;
  specs: Record<string, number | boolean | string>;
  sellPence: number | null;
  best: { supplierName: string; costPence: number | null; inStock: boolean } | null;
}

export interface SolarDesignerProps {
  projectId: string;
  initial: SolarDesignPayload & { version: number | null; savedAt: string | null };
  saved: { pvgisKwh: number | null; pvgisMonthly: number[] | null; googleKwh: number | null; imageryDate: string | null } | null;
  roofStatus: string;
  aerial: { url: string; widthM: number } | null;
  panels: CatalogueOption[];
  inverters: CatalogueOption[];
  batteries: CatalogueOption[];
  rules: { yields: McsYieldRow[] | null; zones: McsZoneRow[] | null; selfConsumption: SelfConsumptionRow[] | null; settings: DesignSettings };
  survey: { occupancy: string | null; annualUsageKwh: number | null; phases: 1 | 3 };
  tariff: { unitRatePence: number; exportRatePence: number } | null;
  postcode: string;
  hasEv: boolean;
  photos: { url: string; label: string }[];
}

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const FACING = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const facing = (az: number) => FACING[Math.round((((az % 360) + 360) % 360) / 45) % 8]!;
const cosd = (deg: number) => Math.cos((deg * Math.PI) / 180) || 1;
const polygonOf = (s: Segment) => [
  { x: s.insetLeft, y: 0 },
  { x: s.width - s.insetRight, y: 0 },
  { x: s.width, y: s.depth },
  { x: 0, y: s.depth },
];
const segTransform = (s: Segment) => `translate(${s.origin.x} ${s.origin.y}) rotate(${s.azimuth - 180}) translate(${-s.width / 2} ${(-s.depth * cosd(s.pitch)) / 2}) scale(1 ${cosd(s.pitch)})`;
const pct = (f: number | null) => (f === null ? "—" : `${Math.round(f * 100)}%`);

/** Client coordinates to an SVG element's own coordinate system. */
function toLocal(el: SVGGraphicsElement, clientX: number, clientY: number) {
  const ctm = el.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

export function SolarDesigner(props: SolarDesignerProps) {
  const router = useRouter();
  const [segments, setSegments] = useState<Segment[]>(props.initial.segments);
  const [roofSource] = useState(props.initial.roofSource);
  const [panelId, setPanelId] = useState<string | null>(props.initial.panelProductId ?? props.panels[0]?.id ?? null);
  const [inverterChoice, setInverterChoice] = useState<string>(props.initial.inverterProductId ?? "auto");
  const [batteryId, setBatteryId] = useState<string | null>(props.initial.batteryProductId);
  const [batteryCount, setBatteryCount] = useState(props.initial.batteryCount || 1);
  const [selectedSeg, setSelectedSeg] = useState<string | null>(props.initial.segments.find((s) => s.used)?.id ?? null);
  const [selectedPanel, setSelectedPanel] = useState<{ seg: string; i: number } | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [shading, setShading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; at: string | null; version: number | null; error?: string }>({
    state: props.initial.version ? "saved" : "idle",
    at: props.initial.savedAt,
    version: props.initial.version,
  });
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const firstRender = useRef(true);

  const panel = props.panels.find((p) => p.id === panelId) ?? null;
  const panelSize = panel?.specs.width_mm && panel.specs.height_mm ? { width: Number(panel.specs.width_mm) / 1000, height: Number(panel.specs.height_mm) / 1000 } : null;
  const setback = props.rules.settings.edgeSetbackM;
  const totalPanels = segments.filter((s) => s.used).reduce((n, s) => n + s.panels.length, 0);
  const kWp = panel?.specs.watts_peak ? (totalPanels * Number(panel.specs.watts_peak)) / 1000 : 0;
  const autoInverter = useMemo(
    () => matchInverter(props.inverters.map((i) => ({ ...i, specs: i.specs as InverterSpecs })), kWp, { battery: Boolean(batteryId) }),
    [props.inverters, kWp, batteryId],
  );
  const inverterId = inverterChoice === "auto" ? (autoInverter?.id ?? null) : inverterChoice;
  const inverter = props.inverters.find((i) => i.id === inverterId) ?? null;
  const battery = props.batteries.find((b) => b.id === batteryId) ?? null;

  const result = useMemo(
    () =>
      evaluateSolarDesign({
        arrays: segments.filter((s) => s.used).map((s) => ({ id: s.id, label: s.label, pitch: s.pitch, azimuth: s.azimuth, panelCount: s.panels.length, shadeFactor: s.shadeFactor })),
        panel: panel ? { specs: panel.specs as PanelSpecs } : null,
        inverter: inverter ? { specs: inverter.specs as InverterSpecs } : null,
        battery: battery ? { usableKwh: Number(battery.specs.usable_kwh ?? battery.specs.capacity_kwh ?? 0), count: batteryCount } : null,
        postcode: props.postcode,
        phases: props.survey.phases,
        survey: { occupancy: props.survey.occupancy, annualUsageKwh: props.survey.annualUsageKwh },
        tariff: props.tariff,
        hasEv: props.hasEv,
        rules: props.rules,
      }),
    [segments, panel, inverter, battery, batteryCount, props.postcode, props.survey, props.tariff, props.hasEv, props.rules],
  );

  const payload: SolarDesignPayload = useMemo(
    () => ({ roofSource, segments, panelProductId: panelId, inverterProductId: inverterId, batteryProductId: batteryId, batteryCount: batteryId ? batteryCount : 0 }),
    [roofSource, segments, panelId, inverterId, batteryId, batteryCount],
  );

  // Autosave: each change becomes a new version, a moment after editing stops.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSave((s) => ({ ...s, state: "saving" }));
    const t = setTimeout(async () => {
      const r = await saveSolarDesignAction(props.projectId, payload);
      if (r.error) setSave((s) => ({ ...s, state: "error", error: r.error }));
      else {
        setSave({ state: "saved", at: r.savedAt ?? new Date().toISOString(), version: r.version ?? null });
        router.refresh();
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [payload, props.projectId, router]);

  const flash = useCallback((m: string) => {
    setMessage(m);
    setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 4000);
  }, []);

  const updateSeg = (id: string, fn: (s: Segment) => Segment) => setSegments((all) => all.map((s) => (s.id === id ? fn(s) : s)));
  const seg = segments.find((s) => s.id === selectedSeg) ?? null;

  function fill(s: Segment) {
    if (!panelSize) return flash("The chosen panel needs its width and height in Settings › Products.");
    if (setback == null) return flash("Set the panel edge setback in Settings › Design rules before auto-filling.");
    const placed = autoFill(polygonOf(s), panelSize, { setback, landscape: s.landscape, obstructions: s.obstructions });
    updateSeg(s.id, (x) => ({ ...x, panels: placed.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000, w: p.w, h: p.h })), used: true }));
    flash(`${placed.length} panels placed on ${s.label}.`);
  }

  function onSegmentPointer(e: React.PointerEvent<SVGPolygonElement>, s: Segment) {
    const local = toLocal(e.currentTarget, e.clientX, e.clientY);
    if (!local) return;
    setSelectedSeg(s.id);
    if (tool === "panels") {
      if (!panelSize) return flash("The chosen panel needs its width and height in Settings › Products.");
      const w = s.landscape ? panelSize.height : panelSize.width;
      const h = s.landscape ? panelSize.width : panelSize.height;
      const r = { x: Math.round((local.x - w / 2) * 20) / 20, y: Math.round((local.y - h / 2) * 20) / 20, w, h };
      const clash = [...s.panels, ...s.obstructions].some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
      if (clash || !rectFits(r, polygonOf(s), setback ?? 0)) return flash("A panel doesn't fit there (edge setback, another panel or an obstruction).");
      updateSeg(s.id, (x) => ({ ...x, panels: [...x.panels, r], used: true }));
    } else if (tool === "obstruction") {
      const o = { x: Math.round((local.x - 0.4) * 20) / 20, y: Math.round((local.y - 0.4) * 20) / 20, w: 0.8, h: 0.8, label: "Chimney" };
      updateSeg(s.id, (x) => ({ ...x, obstructions: [...x.obstructions, o], panels: x.panels.filter((p) => !(p.x < o.x + o.w + (setback ?? 0) && p.x + p.w + (setback ?? 0) > o.x && p.y < o.y + o.h + (setback ?? 0) && p.y + p.h + (setback ?? 0) > o.y)) }));
      setTool("select");
    }
  }

  function onBackgroundPointer(e: React.PointerEvent<SVGRectElement>) {
    if (tool !== "draw" || !svgRef.current) return;
    const p = toLocal(svgRef.current, e.clientX, e.clientY);
    if (!p) return;
    const ids = new Set(segments.map((s) => s.id));
    const id = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !ids.has(l)) ?? `R${segments.length + 1}`;
    const s: Segment = { id, label: `Roof ${id} · south`, pitch: 35, azimuth: 180, origin: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }, width: 8, depth: 5, insetLeft: 0, insetRight: 0, panels: [], obstructions: [], landscape: false, shadeFactor: 1, used: true, sunshineHours: null, suggestedPanels: null };
    setSegments((all) => [...all, s]);
    setSelectedSeg(id);
    setTool("select");
    flash("Roof added. Set its size, pitch and direction in the Roof card.");
  }

  // View: the aerial tile, or the area around the roofs on a plain grid.
  const view = useMemo(() => {
    if (props.aerial) return { cx: 0, cy: 0, size: props.aerial.widthM };
    if (!segments.length) return { cx: 0, cy: 0, size: 30 };
    const xs = segments.flatMap((s) => [s.origin.x - s.width, s.origin.x + s.width]);
    const ys = segments.flatMap((s) => [s.origin.y - s.depth, s.origin.y + s.depth]);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, size: Math.max(20, Math.max(...xs) - Math.min(...xs) + 8, Math.max(...ys) - Math.min(...ys) + 8) };
  }, [props.aerial, segments]);
  const vs = view.size / zoom;
  const maxSun = Math.max(1, ...segments.map((s) => s.sunshineHours ?? 0));
  const g99 = result.connection?.form === "G99";
  const savedLabel = save.state === "saving" ? "Saving…" : save.state === "error" ? `Not saved: ${save.error}` : save.at ? `Saved ${timeAgo(save.at)}` : "Not saved yet";

  const tools: { key: Tool | "autofill"; label: string; icon: typeof MousePointer2 }[] = [
    { key: "select", label: "Select", icon: MousePointer2 },
    { key: "autofill", label: "Auto-fill", icon: Zap },
    { key: "panels", label: "Panels", icon: Grid2x2 },
    { key: "obstruction", label: "Obstruction", icon: OctagonX },
    { key: "draw", label: "Draw roof", icon: Triangle },
  ];

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_380px]">
      <section aria-label="Roof layout" className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-3" role="toolbar" aria-label="Design tools">
          {tools.map((t) => {
            const active = t.key === tool;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={t.key === "autofill" ? undefined : active}
                onClick={() => (t.key === "autofill" ? (seg ? fill(seg) : flash("Select a roof to auto-fill.")) : setTool(t.key))}
                className={cn("inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-ink-2 hover:bg-muted", active && "bg-accent-tint text-accent-strong hover:bg-accent-tint")}
              >
                <t.icon className="size-[18px]" strokeWidth={1.75} aria-hidden /> {t.label}
              </button>
            );
          })}
          {props.photos.length > 0 && (
            <button type="button" onClick={() => setShowPhotos((v) => !v)} aria-pressed={showPhotos} className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-ink-2 hover:bg-muted">
              <Images className="size-[18px]" strokeWidth={1.75} aria-hidden /> Survey photos
            </button>
          )}
          <label className="ml-auto inline-flex items-center gap-2 text-sm font-semibold text-ink-2">
            <input type="checkbox" checked={shading} onChange={(e) => setShading(e.target.checked)} className="size-[18px] accent-[var(--primary)]" /> Shading
          </label>
        </div>

        <div className="relative bg-[#dce5d2]">
          <div className="absolute top-4 left-4 z-10 flex max-w-[60%] flex-col gap-2">
            {segments.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSeg(s.id)}
                aria-pressed={s.id === selectedSeg}
                className={cn(
                  "rounded-md border bg-card px-3 py-1.5 text-left text-sm font-semibold shadow-[0_1px_2px_rgba(16,24,40,0.06)]",
                  s.id === selectedSeg ? "border-2 border-primary text-accent-strong" : "text-ink-2",
                  !s.used && "text-muted-foreground",
                )}
              >
                {s.label.split(" · ")[0]} · {facing(s.azimuth)} · {Math.round(s.pitch)}° · {s.used ? `${s.panels.length} panels` : "not used"}
              </button>
            ))}
            {seg?.obstructions.map((o, i) => (
              <span key={i} className="rounded-md border border-warning-border bg-warning-tint px-3 py-1.5 text-sm font-semibold text-warning-text">
                {o.label}
                {setback != null && ` · ${setback} m setback`}
              </span>
            ))}
          </div>

          <svg
            ref={svgRef}
            viewBox={`${view.cx - vs / 2} ${view.cy - vs / 2} ${vs} ${vs}`}
            className={cn("block aspect-square max-h-[720px] w-full touch-none select-none", tool !== "select" && "cursor-crosshair")}
            role="img"
            aria-label={`Roof plan with ${totalPanels} panels`}
          >
            <rect x={view.cx - view.size} y={view.cy - view.size} width={view.size * 2} height={view.size * 2} fill="#dce5d2" onPointerDown={onBackgroundPointer} />
            {props.aerial ? (
              <image href={props.aerial.url} x={-props.aerial.widthM / 2} y={-props.aerial.widthM / 2} width={props.aerial.widthM} height={props.aerial.widthM} onPointerDown={onBackgroundPointer as never} />
            ) : (
              <g opacity={0.35} pointerEvents="none">
                {Array.from({ length: 41 }, (_, i) => i - 20).map((i) => (
                  <g key={i}>
                    <line x1={view.cx + i * 2} y1={view.cy - 40} x2={view.cx + i * 2} y2={view.cy + 40} stroke="#98a2b3" strokeWidth={0.03} />
                    <line x1={view.cx - 40} y1={view.cy + i * 2} x2={view.cx + 40} y2={view.cy + i * 2} stroke="#98a2b3" strokeWidth={0.03} />
                  </g>
                ))}
              </g>
            )}
            {segments.map((s) => {
              const sel = s.id === selectedSeg;
              const sun = s.sunshineHours ? s.sunshineHours / maxSun : s.shadeFactor;
              return (
                <g key={s.id} transform={segTransform(s)}>
                  <polygon
                    points={polygonOf(s).map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={shading ? `rgba(220,104,3,${0.15 + (1 - sun) * 0.6})` : s.used ? "rgba(185,168,152,0.85)" : "rgba(185,168,152,0.5)"}
                    stroke={sel ? "#0B7A62" : "#8b7b6c"}
                    strokeWidth={sel ? 0.12 : 0.05}
                    strokeDasharray={sel ? "0.35 0.2" : undefined}
                    onPointerDown={(e) => onSegmentPointer(e, s)}
                  />
                  {s.obstructions.map((o, i) => (
                    <rect key={`o${i}`} x={o.x} y={o.y} width={o.w} height={o.h} fill="#8b7b6c" stroke="#DC6803" strokeWidth={0.06} strokeDasharray="0.15 0.1" pointerEvents="none" />
                  ))}
                  {s.panels.map((p, i) => {
                    const on = selectedPanel?.seg === s.id && selectedPanel.i === i;
                    return (
                      <rect
                        key={i}
                        x={p.x}
                        y={p.y}
                        width={p.w}
                        height={p.h}
                        fill="#1f2a44"
                        stroke={on ? "#ffffff" : "#5b6b8c"}
                        strokeWidth={on ? 0.12 : 0.03}
                        onPointerDown={(e) => {
                          if (tool !== "select") return;
                          e.stopPropagation();
                          setSelectedSeg(s.id);
                          setSelectedPanel(on ? null : { seg: s.id, i });
                        }}
                      >
                        <title>{`${s.label} panel ${i + 1}`}</title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
            {/* Scale bar: 5 m */}
            <g transform={`translate(${view.cx - vs / 2 + vs * 0.04} ${view.cy + vs / 2 - vs * 0.06})`} pointerEvents="none">
              <rect x={-0.4} y={-1.2} width={5.8} height={1.8} rx={0.2} fill="#fff" opacity={0.9} />
              <line x1={0} y1={0} x2={5} y2={0} stroke="#101828" strokeWidth={0.08} />
              <text x={2.5} y={-0.4} fontSize={0.7} textAnchor="middle" fill="#101828">
                5 m
              </text>
            </g>
          </svg>

          <div className="absolute top-4 right-4 flex size-14 flex-col items-center justify-center rounded-full border bg-card text-xs font-bold shadow-[0_1px_2px_rgba(16,24,40,0.06)]" aria-label="North is up">
            <span>N</span>
            <span className="h-4 w-0.5 rounded bg-red-600" aria-hidden />
          </div>
          <div className="absolute right-4 bottom-4 flex flex-col overflow-hidden rounded-lg border bg-card shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.4))} className="flex size-11 items-center justify-center border-b hover:bg-muted">
              <Plus className="size-4" aria-hidden />
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z / 1.4))} className="flex size-11 items-center justify-center hover:bg-muted">
              <Minus className="size-4" aria-hidden />
            </button>
          </div>
          {selectedPanel && (
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-white">
              1 panel selected
              <button
                type="button"
                className="rounded-md bg-white/15 px-3 py-1.5"
                onClick={() => {
                  const s = segments.find((x) => x.id === selectedPanel.seg)!;
                  const p = s.panels[selectedPanel.i]!;
                  const r = { x: p.x, y: p.y, w: p.h, h: p.w };
                  const others = s.panels.filter((_, j) => j !== selectedPanel.i);
                  if (!rectFits(r, polygonOf(s), setback ?? 0) || [...others, ...s.obstructions].some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)) return flash("No room to rotate that panel.");
                  updateSeg(s.id, (x) => ({ ...x, panels: x.panels.map((q, j) => (j === selectedPanel.i ? r : q)) }));
                }}
              >
                Rotate
              </button>
              <button
                type="button"
                className="rounded-md bg-white/15 px-3 py-1.5"
                onClick={() => {
                  updateSeg(selectedPanel.seg, (x) => ({ ...x, panels: x.panels.filter((_, j) => j !== selectedPanel.i) }));
                  setSelectedPanel(null);
                }}
              >
                Remove
              </button>
            </div>
          )}
          {message && (
            <p role="status" className="absolute bottom-20 left-1/2 max-w-md -translate-x-1/2 rounded-lg bg-card px-4 py-2 text-center text-sm font-medium shadow-[0_4px_12px_rgba(16,24,40,0.12)]">
              {message}
            </p>
          )}
        </div>

        {props.roofStatus !== "ok" && props.roofStatus !== "drawn" && (
          <p className="border-t bg-info-tint px-4 py-2.5 text-[13px] text-info-text">
            {props.roofStatus === "not_configured"
              ? "Roof data loads automatically once a Google Maps key is set up. Until then, use Draw roof to add each roof face."
              : props.roofStatus === "no_coverage"
                ? "Google has no roof data for this address. Use Draw roof to add each roof face."
                : props.roofStatus === "no_position"
                  ? "We couldn't find this address on the map. Check the site address, or use Draw roof."
                  : "Roof data couldn't be loaded just now. Use Draw roof, or reload to try again."}
          </p>
        )}
        {showPhotos && (
          <ul className="grid grid-cols-3 gap-2 border-t p-3 sm:grid-cols-6">
            {props.photos.map((p, i) => (
              <li key={i} className="overflow-hidden rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs */}
                <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.label} className="aspect-[4/3] w-full object-cover" /></a>
                <span className="block truncate px-2 py-1 text-xs">{p.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-5">
        <p className="flex items-center gap-1.5 text-[13px] text-ink-3" role="status" aria-live="polite">
          {save.state === "saved" && <Check className="size-4 text-success" aria-hidden />}
          {savedLabel}
          {save.version && <span className="text-muted-foreground">· version {save.version}</span>}
        </p>

        {seg && (
          <section aria-labelledby="roof-card" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 id="roof-card" className="text-[17px] font-bold">
                {seg.label.split(" · ")[0]}
              </h2>
              <label className="inline-flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={seg.used} onChange={(e) => updateSeg(seg.id, (x) => ({ ...x, used: e.target.checked }))} className="size-4 accent-[var(--primary)]" /> Use this roof
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {(
                [
                  ["pitch", "Pitch (°)", 0, 70],
                  ["azimuth", "Facing (° from north)", 0, 360],
                  ["width", "Along ridge (m)", 1, 60],
                  ["depth", "Up the slope (m)", 1, 30],
                  ["insetLeft", "Hip inset left (m)", 0, 30],
                  ["insetRight", "Hip inset right (m)", 0, 30],
                  ["shadeFactor", "Shade factor (0–1)", 0.01, 1],
                ] as const
              ).map(([key, label, min, max]) => (
                <label key={key} className="flex flex-col gap-1 text-[13px] font-semibold text-ink-2">
                  {label}
                  <input
                    type="number"
                    step={key === "shadeFactor" ? 0.01 : 0.1}
                    min={min}
                    max={max}
                    value={seg[key]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v) || v < min || v > max) return;
                      updateSeg(seg.id, (x) => {
                        const next = { ...x, [key]: v };
                        if (key === "azimuth") next.label = `${x.label.split(" · ")[0]} · ${facing(v)}`;
                        // Changing the roof's shape drops panels that no longer fit.
                        if (["width", "depth", "insetLeft", "insetRight"].includes(key)) next.panels = x.panels.filter((p) => rectFits(p, polygonOf(next), setback ?? 0));
                        return next;
                      });
                    }}
                    className="h-10 rounded-md border border-input bg-card px-3 text-sm font-normal text-foreground"
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
                <input type="checkbox" checked={seg.landscape} onChange={(e) => updateSeg(seg.id, (x) => ({ ...x, landscape: e.target.checked }))} className="size-4 accent-[var(--primary)]" /> Landscape panels
              </label>
            </div>
            {seg.suggestedPanels != null && <p className="text-[13px] text-muted-foreground">Google suggests up to {seg.suggestedPanels} panels on this roof.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => fill(seg)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-3 text-[13px] font-semibold text-ink-2 hover:bg-surface-subtle">
                <Sparkles className="size-4" aria-hidden /> Auto-fill
              </button>
              <button type="button" onClick={() => updateSeg(seg.id, (x) => ({ ...x, panels: [] }))} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-[13px] font-semibold text-ink-2 hover:bg-surface-subtle">
                Clear panels
              </button>
              {seg.obstructions.length > 0 && (
                <button type="button" onClick={() => updateSeg(seg.id, (x) => ({ ...x, obstructions: [] }))} className="inline-flex h-9 items-center rounded-md border border-input px-3 text-[13px] font-semibold text-ink-2 hover:bg-surface-subtle">
                  Clear obstructions
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Delete ${seg.label.split(" · ")[0]}?`)) return;
                  setSegments((all) => all.filter((s) => s.id !== seg.id));
                  setSelectedSeg(null);
                }}
                className="inline-flex h-9 items-center rounded-md px-3 text-[13px] font-semibold text-red-700 hover:bg-red-50"
              >
                Delete roof
              </button>
            </div>
          </section>
        )}

        <section aria-labelledby="equipment" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
          <h2 id="equipment" className="text-[17px] font-bold">
            Equipment
          </h2>
          <EquipmentSelect
            id="eq-panel"
            label={`Panel × ${totalPanels}`}
            value={panelId ?? ""}
            onChange={(v) => setPanelId(v || null)}
            options={props.panels}
            empty="Add panels in Settings › Products"
          />
          <EquipmentSelect
            id="eq-inverter"
            label="Inverter"
            value={inverterChoice}
            onChange={setInverterChoice}
            options={props.inverters}
            auto={autoInverter ? `Auto-match: ${autoInverter.name}` : "Auto-match (no inverter fits yet)"}
            empty="Add inverters in Settings › Products"
            hint={result.dcAc ? `DC/AC ${result.dcAc}` : undefined}
          />
          <div className="flex gap-2.5">
            <div className="flex-1">
              <EquipmentSelect id="eq-battery" label="Battery" value={batteryId ?? ""} onChange={(v) => setBatteryId(v || null)} options={props.batteries} none="No battery" empty="Add batteries in Settings › Products" />
            </div>
            {batteryId && (
              <label className="flex w-20 flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
                Qty
                <input type="number" min={1} max={10} value={batteryCount} onChange={(e) => setBatteryCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className="h-10 rounded-md border border-input px-3 text-sm font-normal" />
              </label>
            )}
          </div>
          {result.strings && (
            <p className="text-[13px] text-ink-3">
              Strings: {result.strings.map((n, i) => `${i + 1}: ${n} panels`).join(" · ")}
            </p>
          )}
        </section>

        <section aria-labelledby="results" className="flex flex-col gap-4 rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 id="results" className="text-[17px] font-bold">
              Results
            </h2>
            <span className="text-[13px] font-semibold text-ink-3">MCS method</span>
          </div>
          <div className="rounded-[10px] bg-accent-tint p-4">
            <p className="text-sm font-medium text-accent-strong">Annual generation</p>
            <p className="stat text-[32px] leading-tight font-bold text-accent-strong">{result.annualKwh !== null ? `${result.annualKwh.toLocaleString("en-GB")} kWh` : "—"}</p>
            {props.saved?.pvgisKwh && result.annualKwh ? (
              <p className="text-[13px] font-medium text-accent-strong">
                PVGIS cross-check {props.saved.pvgisKwh.toLocaleString("en-GB")} kWh ({props.saved.pvgisKwh >= result.annualKwh ? "+" : ""}
                {(((props.saved.pvgisKwh - result.annualKwh) / result.annualKwh) * 100).toFixed(1)}%)
              </p>
            ) : (
              result.annualKwh === null && <p className="text-[13px] text-accent-strong">Needs your MCS tables (see below).</p>
            )}
            {props.saved?.googleKwh && result.annualKwh ? (
              <p className="text-[13px] font-medium text-accent-strong">
                Google Solar estimate {props.saved.googleKwh.toLocaleString("en-GB")} kWh DC ({props.saved.googleKwh >= result.annualKwh ? "+" : ""}
                {(((props.saved.googleKwh - result.annualKwh) / result.annualKwh) * 100).toFixed(1)}%)
              </p>
            ) : null}
            {props.saved?.imageryDate && <p className="text-xs text-accent-strong/80">Aerial imagery from {new Date(props.saved.imageryDate).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</p>}
          </div>
          <dl className="grid grid-cols-2 gap-4">
            <Figure label="System size" value={`${result.kWp.toFixed(2)} kWp`} />
            <Figure label="Self-use" value={result.selfUseWithBattery !== null ? `${pct(result.selfUse)} → ${pct(result.selfUseWithBattery)}` : pct(result.selfUse)} sub={result.selfUseWithBattery !== null ? "with battery" : undefined} />
            <Figure label="Yearly saving" value={result.yearlySavingPence !== null ? formatPence(Math.round(result.yearlySavingPence / 100) * 100) : "—"} />
            {props.hasEv && <Figure label="EV miles from solar" value={result.evMiles !== null ? result.evMiles.toLocaleString("en-GB") : "—"} />}
          </dl>
          <button type="button" onClick={() => setShowBreakdown((v) => !v)} aria-expanded={showBreakdown} className="self-start text-sm font-semibold text-primary hover:text-accent-strong">
            {showBreakdown ? "Hide breakdown" : "See monthly breakdown →"}
          </button>
          {showBreakdown && (
            <div className="flex flex-col gap-3">
              {props.saved?.pvgisMonthly ? (
                <figure className="flex flex-col gap-1">
                  <div className="flex h-24 items-end gap-1" role="img" aria-label={`Monthly generation (PVGIS): ${props.saved.pvgisMonthly.map((v, i) => `${MONTHS[i]} ${v} kWh`).join(", ")}`}>
                    {props.saved.pvgisMonthly.map((v, i) => (
                      <span key={i} className="flex-1 rounded-t-sm bg-primary" style={{ height: `${(v / Math.max(...props.saved!.pvgisMonthly!)) * 100}%` }} />
                    ))}
                  </div>
                  <div className="flex gap-1 text-center text-[11px] text-muted-foreground" aria-hidden>
                    {MONTHS.map((m, i) => (
                      <span key={i} className="flex-1">
                        {m}
                      </span>
                    ))}
                  </div>
                  <figcaption className="text-xs text-muted-foreground">Monthly profile from PVGIS, kWh.</figcaption>
                </figure>
              ) : (
                <p className="text-[13px] text-muted-foreground">The monthly chart appears once PVGIS has run for this design.</p>
              )}
              <table className="w-full text-[13px]">
                <thead className="text-left text-ink-3">
                  <tr>
                    <th className="py-1 font-semibold">Roof</th>
                    <th className="py-1 text-right font-semibold">Panels</th>
                    <th className="py-1 text-right font-semibold">kWp</th>
                    <th className="py-1 text-right font-semibold">Pitch / facing</th>
                    <th className="py-1 text-right font-semibold">SF</th>
                    <th className="py-1 text-right font-semibold">kWh/yr</th>
                  </tr>
                </thead>
                <tbody>
                  {result.perArray.map((a) => (
                    <tr key={a.id} className="border-t border-divider">
                      <td className="py-1.5">{a.label.split(" · ")[0]}</td>
                      <td className="py-1.5 text-right">{a.panels}</td>
                      <td className="py-1.5 text-right">{a.kWp.toFixed(2)}</td>
                      <td className="py-1.5 text-right">
                        {Math.round(a.pitch)}° / {Math.round(a.azimuth)}°
                      </td>
                      <td className="py-1.5 text-right">{a.shadeFactor}</td>
                      <td className="py-1.5 text-right">{a.annualKwh ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {g99 && result.connection && (
          <section className="flex gap-3 rounded-lg border border-warning-border bg-warning-tint p-5" aria-labelledby="g99">
            <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
            <div>
              <h2 id="g99" className="font-bold text-warning-text">
                G99 application needed
              </h2>
              <p className="text-sm text-warning-text">
                Export capacity is {result.exportKw} kW, over {result.connection.thresholdKw} kW. Apply to the DNO before install; it joins the paperwork list when paperwork arrives.
              </p>
            </div>
          </section>
        )}

        {result.notes.length > 0 && (
          <section aria-labelledby="needs" className="flex flex-col gap-2 rounded-lg border border-info/30 bg-info-tint p-5">
            <h2 id="needs" className="text-sm font-bold text-info-text">
              To finish the figures
            </h2>
            <ul className="list-disc pl-5 text-[13px] text-info-text">
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="stat text-xl font-bold">{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function EquipmentSelect({
  id,
  label,
  value,
  onChange,
  options,
  auto,
  none,
  empty,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: CatalogueOption[];
  auto?: string;
  none?: string;
  empty: string;
  hint?: string;
}) {
  const chosen = options.find((o) => o.id === value);
  const detail = chosen
    ? [chosen.best?.costPence != null ? `${formatPence(chosen.best.costPence)} each` : null, chosen.best ? (chosen.best.inStock ? `in stock at ${chosen.best.supplierName}` : `from ${chosen.best.supplierName}`) : "no supplier price", hint].filter(Boolean).join(" · ")
    : hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      {options.length === 0 ? (
        <p className="rounded-md border border-dashed border-input px-3 py-2 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-11">
          {auto && <option value="auto">{auto}</option>}
          {none && <option value="">{none}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      )}
      {detail && <span className="text-[13px] text-muted-foreground">{detail}</span>}
    </div>
  );
}
