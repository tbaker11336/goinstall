import "server-only";
import type { LayoutSnapshot } from "@goinstall/core";
import type { Tx } from "@goinstall/db";
import { fileStore } from "./files";
import { AERIAL_SIZE_PX, AERIAL_ZOOM, aerialWidthM, googleMaps } from "./site";

/**
 * Save the site's aerial image with the design's panel geometry, so the
 * proposal can show the layout (and keep showing it after the design or the
 * imagery changes). Null when Google isn't configured or the site has no
 * position: the proposal then shows a roof sketch.
 */
export async function captureLayout(tx: Tx, p: { projectId: string; companyId: string; solarDesignId: string; segments: unknown }): Promise<LayoutSnapshot | null> {
  const maps = googleMaps();
  if (!maps) return null;
  const site = await tx.selectFrom("projects").select(["lat", "lng"]).where("id", "=", p.projectId).executeTakeFirst();
  if (site?.lat == null || site.lng == null) return null;
  const segments = ((p.segments ?? []) as LayoutSnapshot["segments"] & { used?: boolean }[])
    .filter((s) => (s as { used?: boolean }).used !== false && s.panels?.length)
    .map((s) => ({ origin: s.origin, width: s.width, depth: s.depth, pitch: s.pitch, azimuth: s.azimuth, panels: s.panels }));
  if (!segments.length) return null;
  const path = `${p.companyId}/${p.projectId}/layout-${p.solarDesignId}.png`;
  try {
    const res = await fetch(maps.staticMapUrl({ lat: site.lat, lng: site.lng }, { zoom: AERIAL_ZOOM, size: AERIAL_SIZE_PX }));
    if (!res.ok) return null;
    await fileStore().put(path, new Uint8Array(await res.arrayBuffer()), "image/png");
  } catch (e) {
    // Already saved for this design version (the store refuses to overwrite): reuse it.
    if (!(e instanceof Error && /exist|duplicate|EEXIST/i.test(e.message))) return null;
  }
  return { path, widthM: aerialWidthM(site.lat), segments };
}
