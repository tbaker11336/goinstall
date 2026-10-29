/// <reference types="google.maps" />
"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Half-width of the drawable plan around the site centre, metres. */
export const PLAN_EXTENT_M = 80;

const R = 6378137;
/** Plan metres (east, south of the centre) to a map position. */
function fromLocal(centre: { lat: number; lng: number }, x: number, y: number) {
  return {
    lat: centre.lat - ((y / (Math.PI * R)) * 180),
    lng: centre.lng + ((x / (Math.PI * R * Math.cos((centre.lat * Math.PI) / 180))) * 180),
  };
}

let loading: Promise<void> | null = null;
/** Load the Maps JavaScript API once per page. */
function loadMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.google?.maps?.Map) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const cb = "__goinstallMapsReady";
    (window as unknown as Record<string, () => void>)[cb] = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key: apiKey, v: "weekly", callback: cb, loading: "async" })}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Google Maps didn't load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * A Google satellite map with its own zoom, pan and map-type controls, and
 * the designer's plan drawn on it as an SVG in metres. Tilt and rotation are
 * off so north stays up and the plan stays aligned with the imagery.
 */
export function PlanMap({
  apiKey,
  centre,
  capture,
  svgRef,
  label,
  className,
  onFail,
  children,
}: {
  apiKey: string;
  centre: { lat: number; lng: number };
  /** True while a drawing tool is active: the plan takes the pointer instead of the map. */
  capture: boolean;
  svgRef: RefObject<SVGSVGElement | null>;
  label: string;
  className?: string;
  onFail: (message: string) => void;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const overlay = useRef<google.maps.OverlayView | null>(null);
  const centreRef = useRef(centre);
  const captureRef = useRef(capture);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMaps(apiKey)
      .then(() => {
        if (cancelled || !host.current || map.current) return;
        const m = new google.maps.Map(host.current, {
          center: centreRef.current,
          // Close enough to see each panel; scroll or pinch for more.
          zoom: 21,
          maxZoom: 22,
          minZoom: 15,
          mapTypeId: "satellite",
          tilt: 0,
          heading: 0,
          rotateControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeControl: true,
          mapTypeControlOptions: { mapTypeIds: ["satellite", "hybrid", "roadmap"] },
          zoomControl: true,
          scaleControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          keyboardShortcuts: true,
        });
        // Google's 45° imagery would tilt the view away from the plan.
        m.addListener("tilt_changed", () => m.getTilt() !== 0 && m.setTilt(0));
        const div = document.createElement("div");
        div.style.position = "absolute";
        // The plan covers the whole view, so it can't simply swallow every
        // event (that also blocked wheel and pinch zoom). Presses on a shape,
        // or anywhere while a drawing tool is on, stay with the plan so the
        // map doesn't pan; the wheel and two-finger gestures always reach the map.
        const keep = (e: Event) => {
          if (e instanceof TouchEvent && e.touches.length > 1) return;
          const onShape = e.target instanceof Element && e.target !== div && e.target.tagName.toLowerCase() !== "svg";
          if (captureRef.current || onShape) e.stopPropagation();
        };
        for (const type of ["pointerdown", "mousedown", "touchstart", "click", "dblclick", "contextmenu"]) div.addEventListener(type, keep);
        class Plan extends google.maps.OverlayView {
          onAdd() {
            this.getPanes()!.overlayMouseTarget.appendChild(div);
          }
          draw() {
            const proj = this.getProjection();
            const c = centreRef.current;
            const sw = proj.fromLatLngToDivPixel(new google.maps.LatLng(fromLocal(c, -PLAN_EXTENT_M, PLAN_EXTENT_M)))!;
            const ne = proj.fromLatLngToDivPixel(new google.maps.LatLng(fromLocal(c, PLAN_EXTENT_M, -PLAN_EXTENT_M)))!;
            div.style.left = `${sw.x}px`;
            div.style.top = `${ne.y}px`;
            div.style.width = `${ne.x - sw.x}px`;
            div.style.height = `${sw.y - ne.y}px`;
          }
          onRemove() {
            div.remove();
          }
        }
        const o = new Plan();
        o.setMap(m);
        map.current = m;
        overlay.current = o;
        setLayer(div);
      })
      .catch((e: Error) => !cancelled && onFail(e.message));
    return () => {
      cancelled = true;
    };
  }, [apiKey, onFail]);

  // A new site centre (postcode search): move the map and redraw the plan around it.
  useEffect(() => {
    centreRef.current = centre;
    if (map.current) {
      map.current.setCenter(centre);
      overlay.current?.draw();
    }
  }, [centre]);

  useEffect(() => {
    captureRef.current = capture;
    map.current?.setOptions({ draggableCursor: capture ? "crosshair" : null });
  }, [capture]);

  return (
    <div className={className}>
      <div ref={host} className="absolute inset-0" />
      {layer &&
        createPortal(
          <svg
            ref={svgRef}
            viewBox={`${-PLAN_EXTENT_M} ${-PLAN_EXTENT_M} ${PLAN_EXTENT_M * 2} ${PLAN_EXTENT_M * 2}`}
            preserveAspectRatio="none"
            width="100%"
            height="100%"
            className={capture ? "block touch-none select-none" : "block select-none"}
            // Only the drawn shapes take the pointer in Select, so the map pans everywhere else.
            style={{ pointerEvents: "none", overflow: "visible", cursor: capture ? "crosshair" : undefined }}
            role="img"
            aria-label={label}
          >
            {children}
          </svg>,
          layer,
        )}
    </div>
  );
}
