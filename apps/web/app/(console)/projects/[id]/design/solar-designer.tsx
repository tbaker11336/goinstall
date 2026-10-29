"use client";

import {
  autoAssignStrings,
  autoFill,
  CABLE_KINDS,
  CABLE_LABELS,
  cableLength,
  distance,
  drawnStrings,
  EMPTY_MARKUP,
  evaluateSolarDesign,
  fillArea,
  movePanel,
  formatPence,
  MARKER_CODES,
  MARKER_KINDS,
  MARKER_LABELS,
  matchInverter,
  panelsInArea,
  rectFits,
  type CableKind,
  type DesignSettings,
  type InverterSpecs,
  type MarkerKind,
  type McsYieldRow,
  type McsZoneRow,
  type PanelSpecs,
  type Point,
  type SelfConsumptionRow,
  type SiteMarkup,
  type StringPlan,
} from "@goinstall/core";
import { AlertTriangle, Cable, Check, ChevronDown, ChevronUp, Download, Grid2x2, Images, MapPin, Minus, MousePointer2, OctagonX, Plus, Ruler, Sparkles, Spline, Triangle, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui/input";
import { saveSolarDesignAction, type SolarDesignPayload } from "@/lib/actions/design";
import { relocateSiteAction } from "@/lib/actions/site";
import { AddressSearch } from "./address-search";
import { cn, timeAgo } from "@/lib/utils";
import { SitePlanCard, StringsCard, type PlanItem } from "./designer-cards";
import { PLAN_EXTENT_M, PlanMap } from "./plan-map";
import { CABLE_COLOURS, MARKER_COLOURS, stringColour } from "./plan-style";

type Segment = SolarDesignPayload["segments"][number];
type Tool = "select" | "panels" | "strings" | "obstruction" | "draw" | "measure" | "cable" | "mark";
/** Tools that draw on the whole plan rather than on a roof. */
const PLAN_TOOLS: readonly Tool[] = ["draw", "measure", "cable", "mark"];

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
  /** Site centre, for the live Google map. */
  position: { lat: number; lng: number } | null;
  /** Browser key for the Maps JavaScript API (referrer-restricted); without it the static aerial image is used. */
  mapsBrowserKey: string | null;
  /** Postcode search needs the server-side Google key. */
  canSearch: boolean;
  /** Google's message when it refused the address or roof lookup (key, API or billing settings). */
  googleError?: string | null;
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
const uid = () => Math.random().toString(36).slice(2, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const metres = (n: number) => `${n < 10 ? r2(n) : Math.round(n * 10) / 10} m`;

/** Client coordinates to an SVG element's own coordinate system. */
function toLocal(el: SVGGraphicsElement, clientX: number, clientY: number) {
  const ctm = el.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/** A string plan covering every string number used on the plan; null when nothing is wired. */
function normalisePlan(segments: Segment[], plan: StringPlan | null, mpptCount: number): StringPlan | null {
  const max = Math.max(0, ...segments.flatMap((s) => s.panels.map((p) => p.s ?? 0)));
  if (!max) return null;
  return { strings: Array.from({ length: max }, (_, i) => plan?.strings[i] ?? { mppt: Math.min(i + 1, Math.max(1, mpptCount)) }) };
}

export function SolarDesigner(props: SolarDesignerProps) {
  const router = useRouter();
  const [segments, setSegments] = useState<Segment[]>(props.initial.segments);
  const [roofSource, setRoofSource] = useState(props.initial.roofSource);
  const [panelId, setPanelId] = useState<string | null>(props.initial.panelProductId ?? props.panels[0]?.id ?? null);
  const [inverterChoice, setInverterChoice] = useState<string>(props.initial.inverterProductId ?? "auto");
  const [batteryId, setBatteryId] = useState<string | null>(props.initial.batteryProductId);
  const [batteryCount, setBatteryCount] = useState(props.initial.batteryCount || 1);
  const [markup, setMarkup] = useState<SiteMarkup>(props.initial.siteMarkup ?? EMPTY_MARKUP);
  const [planStrings, setPlanStrings] = useState<StringPlan | null>(props.initial.stringPlan ?? null);
  const [selectedSeg, setSelectedSeg] = useState<string | null>(props.initial.segments.find((s) => s.used)?.id ?? null);
  const [selectedPanel, setSelectedPanel] = useState<{ seg: string; i: number } | null>(null);
  // Drag-and-drop of one placed panel (Select tool).
  const [panelMove, setPanelMove] = useState<{ seg: string; i: number; from: Point; to: Point } | null>(null);
  const [roofsOpen, setRoofsOpen] = useState(true);
  const [selectedItem, setSelectedItem] = useState<PlanItem>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [activeString, setActiveString] = useState(1);
  const [cableKind, setCableKind] = useState<CableKind>("dc");
  const [markerKind, setMarkerKind] = useState<MarkerKind>("meter_box");
  // In-progress gestures: a drag on a roof or the plan, and a cable being drawn.
  const [drag, setDrag] = useState<{ kind: "fill" | "wire" | "measure"; seg?: string; from: Point; to: Point } | null>(null);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
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
  const [position, setPosition] = useState(props.position);
  const [aerial, setAerial] = useState(props.aerial);
  const [roofStatus, setRoofStatus] = useState(props.roofStatus);
  const [mapError, setMapError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
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
  const mpptCount = inverter?.specs.mppt_count ? Number(inverter.specs.mppt_count) : null;
  const stringPlan = useMemo(() => normalisePlan(segments, planStrings, mpptCount ?? 1), [segments, planStrings, mpptCount]);
  const wired = useMemo(() => drawnStrings(segments, stringPlan), [segments, stringPlan]);

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
        wired,
        rules: props.rules,
      }),
    [segments, panel, inverter, battery, batteryCount, props.postcode, props.survey, props.tariff, props.hasEv, props.rules, wired],
  );

  const payload: SolarDesignPayload = useMemo(
    () => ({ roofSource, segments, panelProductId: panelId, inverterProductId: inverterId, batteryProductId: batteryId, batteryCount: batteryId ? batteryCount : 0, siteMarkup: markup, stringPlan }),
    [roofSource, segments, panelId, inverterId, batteryId, batteryCount, markup, stringPlan],
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
  const updateMarkup = useCallback((fn: (m: SiteMarkup) => SiteMarkup) => setMarkup(fn), []);

  function chooseTool(t: Tool) {
    setTool(t);
    setDraft(null);
    setHover(null);
    setDrag(null);
    setSelectedPanel(null);
  }

  function fill(s: Segment) {
    if (!panelSize) return flash("The chosen panel needs its width and height in Settings › Products.");
    if (setback == null) return flash("Set the panel edge setback in Settings › Design rules before auto-filling.");
    const placed = autoFill(polygonOf(s), panelSize, { setback, landscape: s.landscape, obstructions: s.obstructions });
    updateSeg(s.id, (x) => ({ ...x, panels: placed.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000, w: p.w, h: p.h })), used: true }));
    flash(`${placed.length} panels placed on ${s.label}.`);
  }

  function autoAssign() {
    if (!panel || !inverter) return flash("Choose a panel and an inverter first.");
    const r = autoAssignStrings(segments, panel.specs as PanelSpecs, inverter.specs as InverterSpecs, { minDesignTempC: props.rules.settings.minDesignTempC });
    if (!r.ok) return flash(r.missing);
    setSegments(r.arrays);
    setPlanStrings(r.plan);
    flash(`Wired into ${r.plan.strings.length} string${r.plan.strings.length === 1 ? "" : "s"}.`);
  }

  // --- Roof gestures: click or drag with Panels (fill) and Strings (wire). ---
  const dragEl = useRef<SVGPolygonElement | null>(null);
  function onSegmentDown(e: React.PointerEvent<SVGPolygonElement>, s: Segment) {
    const local = toLocal(e.currentTarget, e.clientX, e.clientY);
    if (!local) return;
    setSelectedSeg(s.id);
    if (tool === "panels" || tool === "strings") {
      if (tool === "panels" && !panelSize) return flash("The chosen panel needs its width and height in Settings › Products.");
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragEl.current = e.currentTarget;
      setDrag({ kind: tool === "panels" ? "fill" : "wire", seg: s.id, from: local, to: local });
    } else if (tool === "obstruction") {
      const o = { x: Math.round((local.x - 0.4) * 20) / 20, y: Math.round((local.y - 0.4) * 20) / 20, w: 0.8, h: 0.8, label: "Chimney" };
      const sb = setback ?? 0;
      updateSeg(s.id, (x) => ({ ...x, obstructions: [...x.obstructions, o], panels: x.panels.filter((p) => !(p.x < o.x + o.w + sb && p.x + p.w + sb > o.x && p.y < o.y + o.h + sb && p.y + p.h + sb > o.y)) }));
      chooseTool("select");
    }
  }
  function onSegmentMove(e: React.PointerEvent<SVGPolygonElement>) {
    if (!drag?.seg || !dragEl.current) return;
    const local = toLocal(dragEl.current, e.clientX, e.clientY);
    if (local) setDrag({ ...drag, to: local });
  }
  function onSegmentUp(s: Segment) {
    const d = drag;
    setDrag(null);
    dragEl.current = null;
    if (!d || d.seg !== s.id) return;
    const click = Math.abs(d.to.x - d.from.x) < 0.25 && Math.abs(d.to.y - d.from.y) < 0.25;
    if (d.kind === "fill" && panelSize) {
      if (click) {
        const w = s.landscape ? panelSize.height : panelSize.width;
        const h = s.landscape ? panelSize.width : panelSize.height;
        const r = { x: Math.round((d.from.x - w / 2) * 20) / 20, y: Math.round((d.from.y - h / 2) * 20) / 20, w, h };
        const clash = [...s.panels, ...s.obstructions].some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
        if (clash || !rectFits(r, polygonOf(s), setback ?? 0)) return flash("A panel doesn't fit there (edge setback, another panel or an obstruction).");
        updateSeg(s.id, (x) => ({ ...x, panels: [...x.panels, r], used: true }));
        return;
      }
      const placed = fillArea(polygonOf(s), d, panelSize, { setback: setback ?? 0, landscape: s.landscape, obstructions: s.obstructions, existing: s.panels });
      if (!placed.length) return flash("No panels fit in that area (edge setback, other panels or obstructions).");
      updateSeg(s.id, (x) => ({ ...x, panels: [...x.panels, ...placed], used: true }));
      flash(`${placed.length} panel${placed.length === 1 ? "" : "s"} added to ${s.label.split(" · ")[0]}.`);
    } else if (d.kind === "wire") {
      const hit = click ? s.panels.flatMap((p, i) => (d.from.x >= p.x && d.from.x <= p.x + p.w && d.from.y >= p.y && d.from.y <= p.y + p.h ? [i] : [])) : panelsInArea(s.panels, d);
      if (!hit.length) return;
      // A click on a panel already on this string takes it off; otherwise panels join the active string.
      const off = click && s.panels[hit[0]!]!.s === activeString;
      updateSeg(s.id, (x) => ({ ...x, panels: x.panels.map((p, i) => (hit.includes(i) ? { ...p, s: off ? null : activeString } : p)) }));
    }
  }

  /** Move a placed panel; false (and a message) when it won't fit there. */
  function tryMove(segId: string, i: number, by: { dx: number; dy: number }): boolean {
    const s = segments.find((x) => x.id === segId);
    if (!s) return false;
    const moved = movePanel(polygonOf(s), s.panels, i, by, { setback: setback ?? 0, obstructions: s.obstructions });
    if (!moved) {
      flash("The panel doesn't fit there (edge setback, another panel or an obstruction).");
      return false;
    }
    updateSeg(segId, (x) => ({ ...x, panels: x.panels.map((q, j) => (j === i ? moved : q)) }));
    return true;
  }

  // --- Plan gestures: draw roof, measure, cable, mark. ---
  const planPoint = (e: { clientX: number; clientY: number }) => (svgRef.current ? toLocal(svgRef.current, e.clientX, e.clientY) : null);
  /** Snap cable points to a marker within 0.6 m, so a run starts and ends on the equipment. */
  const snap = (p: Point) => {
    const m = markup.markers.find((k) => distance(k, p) < 0.6);
    return m ? { x: m.x, y: m.y } : { x: r2(p.x), y: r2(p.y) };
  };
  function finishCable(points: Point[] | null) {
    setDraft(null);
    setHover(null);
    if (!points || points.length < 2) return;
    const id = uid();
    setMarkup((m) => ({ ...m, cables: [...m.cables, { id, kind: cableKind, points, extraM: 0, label: "" }] }));
    setSelectedItem({ type: "cable", id });
    flash(`${CABLE_LABELS[cableKind]} cable added: ${cableLength({ points, extraM: 0 })} m on the plan. Add drops and loops under Site plan.`);
  }
  function onPlanDown(e: React.PointerEvent<SVGRectElement>) {
    const p = planPoint(e);
    if (!p) return;
    if (tool === "draw") {
      const ids = new Set(segments.map((s) => s.id));
      const id = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !ids.has(l)) ?? `R${segments.length + 1}`;
      const s: Segment = { id, label: `Roof ${id} · south`, pitch: 35, azimuth: 180, origin: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }, width: 8, depth: 5, insetLeft: 0, insetRight: 0, panels: [], obstructions: [], landscape: false, shadeFactor: 1, used: true, sunshineHours: null, suggestedPanels: null };
      setSegments((all) => [...all, s]);
      setSelectedSeg(id);
      chooseTool("select");
      flash("Roof added. Set its size, pitch and direction in the Roof card.");
    } else if (tool === "measure") {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({ kind: "measure", from: p, to: p });
    } else if (tool === "cable") {
      const q = snap(p);
      setDraft((d) => {
        if (!d) return [q];
        const last = d[d.length - 1]!;
        return distance(last, q) < 0.05 ? d : [...d, q];
      });
    } else if (tool === "mark") {
      const id = uid();
      setMarkup((m) => ({ ...m, markers: [...m.markers, { id, kind: markerKind, x: r2(p.x), y: r2(p.y), note: "" }] }));
      setSelectedItem({ type: "marker", id });
      chooseTool("select");
      flash(`${MARKER_LABELS[markerKind]} marked. Drag it to adjust, or add a note under Site plan.`);
    }
  }
  function onPlanMove(e: React.PointerEvent<SVGRectElement>) {
    const p = planPoint(e);
    if (!p) return;
    if (drag?.kind === "measure") setDrag({ ...drag, to: p });
    else if (tool === "cable" && draft) setHover(snap(p));
  }
  function onPlanUp() {
    if (drag?.kind !== "measure") return;
    const d = drag;
    setDrag(null);
    if (distance(d.from, d.to) < 0.2) return;
    const id = uid();
    setMarkup((m) => ({ ...m, measurements: [...m.measurements, { id, a: { x: r2(d.from.x), y: r2(d.from.y) }, b: { x: r2(d.to.x), y: r2(d.to.y) } }] }));
    setSelectedItem({ type: "measurement", id });
  }

  // Keyboard: Enter finishes a cable, Escape cancels the current gesture.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        if (draft) setDraft(null);
        else if (tool !== "select") chooseTool("select");
        setDrag(null);
        setHover(null);
      } else if (e.key === "Enter" && draft) finishCable(draft);
      else if (selectedPanel && tool === "select" && e.key.startsWith("Arrow")) {
        // The keyboard alternative to dragging a panel: 10 cm a press, 50 cm with Shift.
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 0.1;
        const by = { dx: e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, dy: e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0 };
        tryMove(selectedPanel.seg, selectedPanel.i, by);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function moveMarker(id: string, p: Point) {
    setMarkup((m) => ({ ...m, markers: m.markers.map((k) => (k.id === id ? { ...k, x: r2(p.x), y: r2(p.y) } : k)) }));
  }

  async function runSearch(search: string, place?: { placeId: string; sessionToken: string }) {
    if (searching) return;
    setSearching(true);
    const r = await relocateSiteAction(props.projectId, search, place);
    setSearching(false);
    if (r.error || !r.position) return flash(r.error ?? "Nothing found.");
    setPosition(r.position);
    setAerial({ url: `/api/maps/aerial/${props.projectId}?at=${r.position.lat.toFixed(6)},${r.position.lng.toFixed(6)}`, widthM: r.aerialWidthM! });
    setRoofStatus(r.roofStatus ?? "error");
    const found = r.segments ?? [];
    if (found.length && (!segments.length || window.confirm(`Google found ${found.length} roof face${found.length === 1 ? "" : "s"} here. Replace the current roofs with them? Panels on the current roofs are removed.`))) {
      setSegments(found);
      setRoofSource("google_solar");
      setSelectedSeg(found[0]!.id);
      setPlanStrings(null);
      flash(`Moved to ${search.trim()} with ${found.length} roof face${found.length === 1 ? "" : "s"} from Google.`);
    } else flash(found.length ? `Moved to ${search.trim()}. Your roofs are kept.` : `Moved to ${search.trim()}. Google has no roof data here: use Draw roof.`);
  }

  const useMap = Boolean(props.mapsBrowserKey && position && !mapError);
  // View for the static image: the aerial tile, or the area around the roofs on a plain grid.
  const view = useMemo(() => {
    if (aerial) return { cx: 0, cy: 0, size: aerial.widthM };
    if (!segments.length) return { cx: 0, cy: 0, size: 30 };
    const xs = segments.flatMap((s) => [s.origin.x - s.width, s.origin.x + s.width]);
    const ys = segments.flatMap((s) => [s.origin.y - s.depth, s.origin.y + s.depth]);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, size: Math.max(20, Math.max(...xs) - Math.min(...xs) + 8, Math.max(...ys) - Math.min(...ys) + 8) };
  }, [aerial, segments]);
  const vs = view.size / zoom;
  const cover = useMap ? { x: -PLAN_EXTENT_M, y: -PLAN_EXTENT_M, size: PLAN_EXTENT_M * 2 } : { x: view.cx - view.size, y: view.cy - view.size, size: view.size * 2 };
  const maxSun = Math.max(1, ...segments.map((s) => s.sunshineHours ?? 0));
  const g99 = result.connection?.form === "G99";
  const savedLabel = save.state === "saving" ? "Saving…" : save.state === "error" ? `Not saved: ${save.error}` : save.at ? `Saved ${timeAgo(save.at)}` : "Not saved yet";
  const live = (on: boolean) => (on ? "visiblePainted" : "none");
  const roofTool = tool === "panels" || tool === "strings" || tool === "obstruction";
  const maxString = Math.max(0, ...wired.strings.map((s) => s.n));
  const fillPreview = useMemo(() => {
    if (drag?.kind !== "fill" || !panelSize) return null;
    const s = segments.find((x) => x.id === drag.seg);
    return s ? fillArea(polygonOf(s), drag, panelSize, { setback: setback ?? 0, landscape: s.landscape, obstructions: s.obstructions, existing: s.panels }) : null;
  }, [drag, panelSize, segments, setback]);

  const tools: { key: Tool | "autofill"; label: string; icon: typeof MousePointer2 }[] = [
    { key: "select", label: "Select", icon: MousePointer2 },
    { key: "autofill", label: "Auto-fill", icon: Zap },
    { key: "panels", label: "Panels", icon: Grid2x2 },
    { key: "strings", label: "Strings", icon: Spline },
    { key: "obstruction", label: "Obstruction", icon: OctagonX },
    { key: "draw", label: "Draw roof", icon: Triangle },
    { key: "measure", label: "Measure", icon: Ruler },
    { key: "cable", label: "Cable", icon: Cable },
    { key: "mark", label: "Mark", icon: MapPin },
  ];
  const hint: Partial<Record<Tool, string>> = {
    panels: "Click a roof to place a panel, or drag across it to fill an area.",
    strings: "Click panels, or drag across them, to put them on the chosen string. Click a panel again to take it off.",
    obstruction: "Click a roof to add an obstruction.",
    draw: "Click the map where the roof is.",
    measure: "Drag between two points to measure.",
    cable: "Click to add points along the route; double-click or press Enter to finish. Points snap to markers.",
    mark: "Choose what to mark, then click the map.",
  };

  const plan = (
    <>
      <rect x={cover.x} y={cover.y} width={cover.size} height={cover.size} fill={useMap ? "transparent" : "#dce5d2"} pointerEvents={useMap ? "none" : "visiblePainted"} />
      {!useMap &&
        (aerial ? (
          <image href={aerial.url} x={-aerial.widthM / 2} y={-aerial.widthM / 2} width={aerial.widthM} height={aerial.widthM} pointerEvents="none" />
        ) : (
          <g opacity={0.35} pointerEvents="none">
            {Array.from({ length: 41 }, (_, i) => i - 20).map((i) => (
              <g key={i}>
                <line x1={view.cx + i * 2} y1={view.cy - 40} x2={view.cx + i * 2} y2={view.cy + 40} stroke="#98a2b3" strokeWidth={0.03} />
                <line x1={view.cx - 40} y1={view.cy + i * 2} x2={view.cx + 40} y2={view.cy + i * 2} stroke="#98a2b3" strokeWidth={0.03} />
              </g>
            ))}
          </g>
        ))}
      {segments.map((s) => {
        const sel = s.id === selectedSeg;
        const sun = s.sunshineHours ? s.sunshineHours / maxSun : s.shadeFactor;
        return (
          <g key={s.id} transform={segTransform(s)}>
            <polygon
              points={polygonOf(s).map((p) => `${p.x},${p.y}`).join(" ")}
              fill={shading ? `rgba(220,104,3,${0.15 + (1 - sun) * 0.6})` : s.used ? "rgba(185,168,152,0.7)" : "rgba(185,168,152,0.4)"}
              stroke={sel ? "#0B7A62" : "#8b7b6c"}
              strokeWidth={sel ? 0.12 : 0.05}
              strokeDasharray={sel ? "0.35 0.2" : undefined}
              pointerEvents={live(tool === "select" || roofTool)}
              onPointerDown={(e) => onSegmentDown(e, s)}
              onPointerMove={onSegmentMove}
              onPointerUp={() => onSegmentUp(s)}
              onPointerCancel={() => setDrag(null)}
            />
            {s.obstructions.map((o, i) => (
              <rect key={`o${i}`} x={o.x} y={o.y} width={o.w} height={o.h} fill="#8b7b6c" stroke="#DC6803" strokeWidth={0.06} strokeDasharray="0.15 0.1" pointerEvents="none" />
            ))}
            {s.panels.map((p, i) => {
              const on = selectedPanel?.seg === s.id && selectedPanel.i === i;
              const dragging = panelMove?.seg === s.id && panelMove.i === i;
              const by = dragging ? { dx: panelMove.to.x - panelMove.from.x, dy: panelMove.to.y - panelMove.from.y } : null;
              const fits = by ? movePanel(polygonOf(s), s.panels, i, by, { setback: setback ?? 0, obstructions: s.obstructions }) !== null : true;
              return (
                <g key={i} pointerEvents={live(tool === "select")}>
                  <rect
                    x={by ? p.x + by.dx : p.x}
                    y={by ? p.y + by.dy : p.y}
                    width={p.w}
                    height={p.h}
                    fill="#1f2a44"
                    opacity={dragging ? 0.8 : 1}
                    stroke={!fits ? "#D92D20" : on ? "#ffffff" : p.s ? stringColour(p.s) : "#5b6b8c"}
                    strokeWidth={on || dragging ? 0.12 : p.s ? 0.09 : 0.03}
                    style={tool === "select" ? { cursor: dragging ? "grabbing" : "grab" } : undefined}
                    onPointerDown={(e) => {
                      if (tool !== "select") return;
                      e.stopPropagation();
                      const at = toLocal(e.currentTarget, e.clientX, e.clientY);
                      if (!at) return;
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                      setSelectedSeg(s.id);
                      setPanelMove({ seg: s.id, i, from: at, to: at });
                    }}
                    onPointerMove={(e) => {
                      if (!dragging) return;
                      const at = toLocal(e.currentTarget, e.clientX, e.clientY);
                      if (at) setPanelMove({ ...panelMove, to: at });
                    }}
                    onPointerUp={() => {
                      if (!dragging) return;
                      setPanelMove(null);
                      const d = { dx: panelMove.to.x - panelMove.from.x, dy: panelMove.to.y - panelMove.from.y };
                      // Barely moved: a click, which selects (or deselects) the panel.
                      if (Math.hypot(d.dx, d.dy) < 0.15) return setSelectedPanel(on ? null : { seg: s.id, i });
                      tryMove(s.id, i, d);
                      setSelectedPanel({ seg: s.id, i });
                    }}
                    onPointerCancel={() => setPanelMove(null)}
                  >
                    <title>{`${s.label} panel ${i + 1}${p.s ? `, string ${p.s}` : ""}`}</title>
                  </rect>
                  {p.s && (tool === "strings" || wired.strings.length > 1) && (
                    <text x={p.x + p.w / 2} y={p.y + p.h / 2 + 0.18} fontSize={0.5} fontWeight={700} textAnchor="middle" fill={stringColour(p.s)} pointerEvents="none">
                      {p.s}
                    </text>
                  )}
                </g>
              );
            })}
            {drag?.seg === s.id && (
              <>
                {fillPreview?.map((p, i) => <rect key={`f${i}`} x={p.x} y={p.y} width={p.w} height={p.h} fill="#1f2a44" opacity={0.55} pointerEvents="none" />)}
                <rect
                  x={Math.min(drag.from.x, drag.to.x)}
                  y={Math.min(drag.from.y, drag.to.y)}
                  width={Math.abs(drag.to.x - drag.from.x)}
                  height={Math.abs(drag.to.y - drag.from.y)}
                  fill={drag.kind === "wire" ? `${stringColour(activeString)}33` : "rgba(255,255,255,0.12)"}
                  stroke={drag.kind === "wire" ? stringColour(activeString) : "#ffffff"}
                  strokeWidth={0.06}
                  strokeDasharray="0.25 0.15"
                  pointerEvents="none"
                />
              </>
            )}
          </g>
        );
      })}

      {markup.cables.map((c) => {
        const sel = selectedItem?.type === "cable" && selectedItem.id === c.id;
        const mid = c.points[Math.floor((c.points.length - 1) / 2)]!;
        const next = c.points[Math.floor((c.points.length - 1) / 2) + 1] ?? mid;
        const pts = c.points.map((p) => `${p.x},${p.y}`).join(" ");
        return (
          <g key={c.id} pointerEvents={live(tool === "select")} onPointerDown={() => setSelectedItem({ type: "cable", id: c.id })}>
            <polyline points={pts} fill="none" stroke="#ffffff" strokeWidth={sel ? 0.4 : 0.28} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
            <polyline points={pts} fill="none" stroke={CABLE_COLOURS[c.kind]} strokeWidth={0.16} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={c.kind === "data" ? "0.4 0.25" : undefined}>
              <title>{`${CABLE_LABELS[c.kind]} cable, ${cableLength(c)} m`}</title>
            </polyline>
            <PlanLabel x={(mid.x + next.x) / 2} y={(mid.y + next.y) / 2} text={`${CABLE_LABELS[c.kind]} ${cableLength(c)} m`} colour={CABLE_COLOURS[c.kind]} />
          </g>
        );
      })}
      {draft && (
        <g pointerEvents="none">
          <polyline points={[...draft, ...(hover ? [hover] : [])].map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={CABLE_COLOURS[cableKind]} strokeWidth={0.16} strokeDasharray="0.3 0.2" strokeLinecap="round" />
          {draft.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={0.18} fill="#ffffff" stroke={CABLE_COLOURS[cableKind]} strokeWidth={0.06} />
          ))}
          {hover && <PlanLabel x={hover.x} y={hover.y - 0.8} text={metres(cableLength({ points: [...draft, hover], extraM: 0 }))} colour={CABLE_COLOURS[cableKind]} />}
        </g>
      )}

      {[...markup.measurements, ...(drag?.kind === "measure" ? [{ id: "draft", a: drag.from, b: drag.to }] : [])].map((m) => {
        const sel = selectedItem?.type === "measurement" && selectedItem.id === m.id;
        return (
          <g key={m.id} pointerEvents={live(tool === "select" && m.id !== "draft")} onPointerDown={() => setSelectedItem({ type: "measurement", id: m.id })}>
            <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke="#101828" strokeWidth={sel ? 0.22 : 0.16} strokeLinecap="round" />
            <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke="#ffffff" strokeWidth={0.07} strokeDasharray="0.3 0.15" />
            {[m.a, m.b].map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={0.14} fill="#ffffff" stroke="#101828" strokeWidth={0.05} />
            ))}
            <PlanLabel x={(m.a.x + m.b.x) / 2} y={(m.a.y + m.b.y) / 2} text={metres(distance(m.a, m.b))} colour="#101828" />
          </g>
        );
      })}

      {markup.markers.map((m) => {
        const sel = selectedItem?.type === "marker" && selectedItem.id === m.id;
        const code = MARKER_CODES[m.kind];
        return (
          <g
            key={m.id}
            transform={`translate(${m.x} ${m.y})`}
            pointerEvents={live(tool === "select")}
            tabIndex={0}
            role="button"
            aria-label={`${MARKER_LABELS[m.kind]}${m.note ? `: ${m.note}` : ""}. Arrow keys move it, Delete removes it.`}
            className="cursor-grab outline-none"
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as SVGGElement).setPointerCapture?.(e.pointerId);
              setSelectedItem({ type: "marker", id: m.id });
              setMoving(m.id);
            }}
            onPointerMove={(e) => {
              if (moving !== m.id) return;
              const p = planPoint(e);
              if (p) moveMarker(m.id, p);
            }}
            onPointerUp={() => setMoving(null)}
            onFocus={() => setSelectedItem({ type: "marker", id: m.id })}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 1 : 0.1;
              const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
              if (d) {
                e.preventDefault();
                moveMarker(m.id, { x: m.x + d[0]!, y: m.y + d[1]! });
              } else if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                setMarkup((x) => ({ ...x, markers: x.markers.filter((k) => k.id !== m.id) }));
                setSelectedItem(null);
              }
            }}
          >
            <circle r={0.75} fill="#ffffff" stroke={sel ? "#0B7A62" : MARKER_COLOURS[m.kind]} strokeWidth={sel ? 0.22 : 0.14} />
            <text y={code.length > 2 ? 0.2 : 0.24} fontSize={code.length > 2 ? 0.48 : 0.62} fontWeight={700} textAnchor="middle" fill={MARKER_COLOURS[m.kind]} pointerEvents="none">
              {code}
            </text>
            <title>{`${MARKER_LABELS[m.kind]}${m.note ? `: ${m.note}` : ""}`}</title>
            {(m.note || sel) && <PlanLabel x={0} y={1.4} text={m.note ? (m.note.length > 28 ? `${m.note.slice(0, 27)}…` : m.note) : MARKER_LABELS[m.kind]} colour={MARKER_COLOURS[m.kind]} />}
          </g>
        );
      })}

      {/* Drawing tools take the pointer over the whole plan. */}
      {PLAN_TOOLS.includes(tool) && (
        <rect
          x={cover.x}
          y={cover.y}
          width={cover.size}
          height={cover.size}
          fill="transparent"
          pointerEvents="all"
          aria-hidden
          onPointerDown={onPlanDown}
          onPointerMove={onPlanMove}
          onPointerUp={onPlanUp}
          onDoubleClick={() => tool === "cable" && finishCable(draft)}
        />
      )}

      {!useMap && (
        // Scale bar: 5 m
        <g transform={`translate(${view.cx - vs / 2 + vs * 0.04} ${view.cy + vs / 2 - vs * 0.06})`} pointerEvents="none">
          <rect x={-0.4} y={-1.2} width={5.8} height={1.8} rx={0.2} fill="#fff" opacity={0.9} />
          <line x1={0} y1={0} x2={5} y2={0} stroke="#101828" strokeWidth={0.08} />
          <text x={2.5} y={-0.4} fontSize={0.7} textAnchor="middle" fill="#101828">
            5 m
          </text>
        </g>
      )}
    </>
  );
  const planLabel = `Roof plan with ${totalPanels} panels, ${markup.markers.length} markers and ${markup.cables.length} cables`;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_380px]">
      <section aria-label="Roof layout" className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
        {props.canSearch && <AddressSearch searching={searching} onSearch={runSearch} />}
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-3" role="toolbar" aria-label="Design tools">
          {tools.map((t) => {
            const active = t.key === tool;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={t.key === "autofill" ? undefined : active}
                onClick={() => (t.key === "autofill" ? (seg ? fill(seg) : flash("Select a roof to auto-fill.")) : chooseTool(t.key))}
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

        {tool !== "select" && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-surface-subtle px-4 py-2 text-[13px]" aria-label="Tool options">
            {tool === "strings" && (
              <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="String to wire">
                {Array.from({ length: Math.max(1, maxString) }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={activeString === n}
                    onClick={() => setActiveString(n)}
                    className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-semibold", activeString === n ? "border-2 bg-card" : "border-input text-ink-2")}
                    style={activeString === n ? { borderColor: stringColour(n) } : undefined}
                  >
                    <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: stringColour(n) }} />
                    String {n}
                    <span className="font-normal text-ink-3">({wired.strings.find((s) => s.n === n)?.panels ?? 0})</span>
                  </button>
                ))}
                <button type="button" onClick={() => setActiveString(maxString + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-input px-2.5 font-semibold text-ink-2">
                  <Plus className="size-3.5" aria-hidden /> New string
                </button>
              </div>
            )}
            {tool === "cable" && (
              <>
                <label htmlFor="cable-kind" className="font-semibold text-ink-2">
                  Cable
                </label>
                <Select id="cable-kind" value={cableKind} onChange={(e) => setCableKind(e.target.value as CableKind)} className="h-8 w-36 px-2 text-[13px]">
                  {CABLE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CABLE_LABELS[k]}
                    </option>
                  ))}
                </Select>
                {draft && (
                  <>
                    <button type="button" onClick={() => finishCable(draft)} disabled={draft.length < 2} className="inline-flex h-8 items-center rounded-md bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-50">
                      Finish cable
                    </button>
                    <button type="button" onClick={() => setDraft(null)} className="inline-flex h-8 items-center rounded-md border border-input px-3 font-semibold text-ink-2">
                      Cancel
                    </button>
                  </>
                )}
              </>
            )}
            {tool === "mark" && (
              <>
                <label htmlFor="marker-kind" className="font-semibold text-ink-2">
                  Mark
                </label>
                <Select id="marker-kind" value={markerKind} onChange={(e) => setMarkerKind(e.target.value as MarkerKind)} className="h-8 w-48 px-2 text-[13px]">
                  {MARKER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {MARKER_LABELS[k]}
                    </option>
                  ))}
                </Select>
              </>
            )}
            <span className="text-ink-3">{hint[tool]}</span>
          </div>
        )}

        <div className="relative bg-[#dce5d2]">
          <div className="pointer-events-none absolute top-4 left-4 z-10 flex max-w-[60%] flex-col gap-2">
            {segments.length > 0 && (
              <button
                type="button"
                onClick={() => setRoofsOpen((o) => !o)}
                aria-expanded={roofsOpen}
                aria-controls="roof-list"
                className="pointer-events-auto inline-flex w-fit items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-semibold text-ink-2 shadow-[0_1px_2px_rgba(16,24,40,0.06)]"
              >
                {roofsOpen ? <ChevronUp className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
                Roofs ({segments.length})
              </button>
            )}
            <div id="roof-list" className="contents">
            {segments.filter((s) => roofsOpen || s.id === selectedSeg).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSeg(s.id)}
                aria-pressed={s.id === selectedSeg}
                className={cn(
                  "pointer-events-auto w-fit rounded-md border bg-card px-3 py-1.5 text-left text-sm font-semibold shadow-[0_1px_2px_rgba(16,24,40,0.06)]",
                  s.id === selectedSeg ? "border-2 border-primary text-accent-strong" : "text-ink-2",
                  !s.used && "text-muted-foreground",
                )}
              >
                {s.label.split(" · ")[0]} · {facing(s.azimuth)} · {Math.round(s.pitch)}° · {s.used ? `${s.panels.length} panels` : "not used"}
              </button>
            ))}
            </div>
            {seg?.obstructions.map((o, i) => (
              <span key={i} className="w-fit rounded-md border border-warning-border bg-warning-tint px-3 py-1.5 text-sm font-semibold text-warning-text">
                {o.label}
                {setback != null && ` · ${setback} m setback`}
              </span>
            ))}
          </div>

          {useMap ? (
            <PlanMap
              apiKey={props.mapsBrowserKey!}
              centre={position!}
              capture={tool !== "select"}
              svgRef={svgRef}
              label={planLabel}
              onFail={setMapError}
              className="relative aspect-square max-h-[720px] w-full"
            >
              {plan}
            </PlanMap>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`${view.cx - vs / 2} ${view.cy - vs / 2} ${vs} ${vs}`}
              className={cn("block aspect-square max-h-[720px] w-full touch-none select-none", tool !== "select" && "cursor-crosshair")}
              role="img"
              aria-label={planLabel}
            >
              {plan}
            </svg>
          )}

          {!useMap && (
            <>
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
            </>
          )}
          {selectedPanel && (
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-white">
              1 panel selected
              <span className="font-normal text-white/70 max-sm:hidden">Drag or use the arrow keys to move</span>
              <button
                type="button"
                className="rounded-md bg-white/15 px-3 py-1.5"
                onClick={() => {
                  const s = segments.find((x) => x.id === selectedPanel.seg)!;
                  const p = s.panels[selectedPanel.i]!;
                  const r = { ...p, w: p.h, h: p.w };
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
            <p role="status" className="absolute bottom-20 left-1/2 z-10 max-w-md -translate-x-1/2 rounded-lg bg-card px-4 py-2 text-center text-sm font-medium shadow-[0_4px_12px_rgba(16,24,40,0.12)]">
              {message}
            </p>
          )}
        </div>

        {props.googleError && (
          <p role="alert" className="border-t bg-red-50 px-4 py-2.5 text-[13px] text-red-900">
            Google refused the lookup: {props.googleError}. Check that the server key has the Geocoding, Places (New), Solar and Maps Static APIs enabled, billing on, and no website restriction (Settings › Design rules › Check Google connection).
          </p>
        )}
        {mapError && <p className="border-t bg-warning-tint px-4 py-2.5 text-[13px] text-warning-text">The live Google map couldn&rsquo;t load ({mapError}), so the saved aerial image is shown. Check the browser key&rsquo;s website restrictions.</p>}
        {roofStatus !== "ok" && roofStatus !== "drawn" && (
          <p className="border-t bg-info-tint px-4 py-2.5 text-[13px] text-info-text">
            {roofStatus === "not_configured"
              ? "Roof data loads automatically once a Google Maps key is set up. Until then, use Draw roof to add each roof face."
              : roofStatus === "no_coverage"
                ? "Google has no roof data for this address. Use Draw roof to add each roof face."
                : roofStatus === "no_position"
                  ? "We couldn't find this address on the map. Search for the postcode above, or use Draw roof."
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[13px] text-ink-3" role="status" aria-live="polite">
            {save.state === "saved" && <Check className="size-4 text-success" aria-hidden />}
            {savedLabel}
            {save.version && <span className="text-muted-foreground">· version {save.version}</span>}
          </p>
          {save.version && (
            <div className="flex gap-2">
              <a href={`/api/projects/${props.projectId}/design/plan`} aria-disabled={save.state === "saving"} className={cn("inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-[13px] font-semibold text-ink-2 hover:bg-surface-subtle", save.state === "saving" && "pointer-events-none opacity-50")}>
                <Download className="size-4" aria-hidden /> Download design
              </a>
              <a href={`/api/projects/${props.projectId}/design/sld`} aria-disabled={save.state === "saving"} className={cn("inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-[13px] font-semibold text-ink-2 hover:bg-surface-subtle", save.state === "saving" && "pointer-events-none opacity-50")}>
                <Download className="size-4" aria-hidden /> Download SLD
              </a>
            </div>
          )}
        </div>

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
        </section>

        {totalPanels > 0 && (
          <StringsCard
            wired={wired.strings}
            auto={wired.strings.length ? null : result.strings}
            check={result.stringCheck}
            mpptCount={mpptCount}
            onMppt={(n, mppt) => setPlanStrings({ strings: (stringPlan?.strings ?? []).map((s, i) => (i === n - 1 ? { mppt } : s)) })}
            onAutoAssign={autoAssign}
            onClear={() => {
              setSegments((all) => all.map((s) => ({ ...s, panels: s.panels.map((p) => ({ ...p, s: null })) })));
              setPlanStrings(null);
            }}
            onWireByHand={() => {
              chooseTool("strings");
              setActiveString(1);
            }}
          />
        )}

        <SitePlanCard markup={markup} selected={selectedItem} onSelect={setSelectedItem} onChange={updateMarkup} />

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

/** A small text label with a white backing, drawn in plan metres. */
function PlanLabel({ x, y, text, colour }: { x: number; y: number; text: string; colour: string }) {
  const w = text.length * 0.27 + 0.5;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <rect x={-w / 2} y={-0.42} width={w} height={0.8} rx={0.18} fill="#ffffff" opacity={0.92} />
      <text y={0.18} fontSize={0.5} fontWeight={600} textAnchor="middle" fill={colour}>
        {text}
      </text>
    </g>
  );
}
