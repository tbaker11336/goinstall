import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { AERIAL_SIZE_PX, AERIAL_ZOOM, googleMaps } from "@/lib/site";

export const dynamic = "force-dynamic";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/**
 * Admins: check the Google key works for each API GoInstall uses (Geocoding,
 * Solar, Maps Static), from the server. Reports ok or Google's error, never
 * the key. Makes three billed calls, so it's admin-only and run on demand.
 */
export async function GET() {
  await requireAdmin();
  const maps = googleMaps();
  if (!maps) return NextResponse.json({ google_maps_api_key: "missing" }, { status: 503 });
  const out: Record<string, string> = { google_maps_api_key: "set" };
  let at: { lat: number; lng: number } | null = null;
  try {
    at = await maps.geocode("Bristol Temple Meads, Bristol BS1 6QF");
    out.geocoding = at ? "ok" : "no result";
  } catch (e) {
    out.geocoding = `error: ${message(e)}`;
  }
  at ??= { lat: 51.4492, lng: -2.5813 };
  try {
    const r = await maps.buildingInsights(at);
    out.solar = r.status === "ok" ? `ok (imagery ${r.insights.imageryQuality ?? "?"}${r.insights.imageryDate ? `, ${r.insights.imageryDate}` : ""})` : "ok (no building at the test point)";
  } catch (e) {
    out.solar = `error: ${message(e)}`;
  }
  try {
    const res = await fetch(maps.staticMapUrl(at, { zoom: AERIAL_ZOOM, size: AERIAL_SIZE_PX }));
    out.static_maps = res.ok && (res.headers.get("content-type") ?? "").startsWith("image/") ? "ok" : `error: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    out.static_maps = `error: ${message(e)}`;
  }
  const ok = ["geocoding", "solar", "static_maps"].every((k) => out[k]?.startsWith("ok"));
  return NextResponse.json(out, { status: ok ? 200 : 502 });
}
