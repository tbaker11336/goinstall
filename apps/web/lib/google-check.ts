import "server-only";
import { AERIAL_SIZE_PX, AERIAL_ZOOM, googleMaps } from "./site";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export interface GoogleCheck {
  key: "missing" | "set";
  browserKey: "missing" | "set";
  results: { api: string; ok: boolean; detail: string }[];
}

/**
 * Check the server key works for each Google API GoInstall uses (Geocoding,
 * Solar, Maps Static), from the server. Reports Google's own error, never the
 * key. Three billed calls, so it's admin-only and run on demand.
 */
export async function checkGoogle(): Promise<GoogleCheck> {
  const browserKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY ? "set" : "missing";
  const maps = googleMaps();
  if (!maps) return { key: "missing", browserKey, results: [] };
  const results: GoogleCheck["results"] = [];
  let at: { lat: number; lng: number } | null = null;
  try {
    at = await maps.geocode("Bristol Temple Meads, Bristol BS1 6QF");
    results.push({ api: "Geocoding API (addresses and postcode search)", ok: Boolean(at), detail: at ? "Working" : "No result for a test address" });
  } catch (e) {
    results.push({ api: "Geocoding API (addresses and postcode search)", ok: false, detail: message(e) });
  }
  at ??= { lat: 51.4492, lng: -2.5813 };
  try {
    const r = await maps.buildingInsights(at);
    results.push({ api: "Solar API (roof faces and Google's estimate)", ok: true, detail: r.status === "ok" ? `Working (imagery ${r.insights.imageryQuality ?? "?"})` : "Working (no building at the test point)" });
  } catch (e) {
    results.push({ api: "Solar API (roof faces and Google's estimate)", ok: false, detail: message(e) });
  }
  try {
    const res = await fetch(maps.staticMapUrl(at, { zoom: AERIAL_ZOOM, size: AERIAL_SIZE_PX }));
    const ok = res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
    results.push({ api: "Maps Static API (aerial image)", ok, detail: ok ? "Working" : `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` });
  } catch (e) {
    results.push({ api: "Maps Static API (aerial image)", ok: false, detail: message(e) });
  }
  return { key: "set", browserKey, results };
}
