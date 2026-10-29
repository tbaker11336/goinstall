import "server-only";
import { createGoogleMapsClient, metresPerPixel, toLocalMetres, type BuildingInsights, type GoogleMapsClient, type LatLng } from "@goinstall/integrations";
import { sql, type Tx } from "@goinstall/db";

/** Aerial image zoom; at UK latitudes one 640 px tile is roughly 55 m across. */
export const AERIAL_ZOOM = 20;
export const AERIAL_SIZE_PX = 640;

/** A local stand-in for trying the design map without a key (GOOGLE_FAKE=true, never on Vercel). */
const fakeGoogle: GoogleMapsClient = {
  geocode: async () => ({ lat: 51.4545, lng: -2.5879 }),
  autocomplete: async (input) =>
    ["Rotherfield Road, Bristol, UK", "Rotherfield Avenue, Bath, UK", "Rotherfield Close, Bristol, UK"].map((rest, i) => ({ placeId: `fake-${i}`, main: `${input.match(/^\d+/)?.[0] ?? "1"} ${rest.split(",")[0]}`, secondary: rest.split(", ").slice(1).join(", ") })),
  placeLocation: async (placeId) => ({ at: { lat: 51.4545 + Number(placeId.slice(5)) * 0.001, lng: -2.5879 }, address: placeId }),
  buildingInsights: async () => ({ status: "no_coverage", raw: {} }),
  staticMapUrl: () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
};

export function googleMaps(): GoogleMapsClient | null {
  if (process.env.GOOGLE_FAKE === "true" && process.env.NODE_ENV !== "production" && !process.env.VERCEL) return fakeGoogle;
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return key ? createGoogleMapsClient({ apiKey: key }) : null;
}

/** Width in metres covered by the proxied aerial image. */
export function aerialWidthM(lat: number) {
  return Math.round(AERIAL_SIZE_PX * metresPerPixel(lat, AERIAL_ZOOM) * 100) / 100;
}

export interface SitePosition {
  lat: number;
  lng: number;
}

/**
 * The project's site position, geocoding the site address once (and storing
 * it) when Google is configured. Null without a key or a findable address;
 * `error` carries Google's own message when the request was refused.
 */
export async function ensureSitePosition(
  tx: Tx,
  project: { id: string; lat: number | null; lng: number | null; site_address_line1: string | null; site_town: string | null; site_postcode: string | null },
): Promise<{ position: SitePosition | null; error: string | null }> {
  if (project.lat != null && project.lng != null) return { position: { lat: project.lat, lng: project.lng }, error: null };
  const maps = googleMaps();
  const address = [project.site_address_line1, project.site_town, project.site_postcode].filter(Boolean).join(", ");
  if (!maps || !address) return { position: null, error: null };
  try {
    const at = await maps.geocode(address);
    if (!at) return { position: null, error: null };
    await tx.updateTable("projects").set({ lat: at.lat, lng: at.lng }).where("id", "=", project.id).execute();
    return { position: at, error: null };
  } catch (e) {
    return { position: null, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}

export interface RoofData {
  status: "ok" | "no_coverage" | "error" | "not_configured" | "no_position";
  imageryQuality: string | null;
  insights: BuildingInsights | null;
  fetchedAt: Date | null;
  /** Google's message when the lookup failed (not cached, so a later visit retries). */
  error?: string | null;
}

/** Google Solar API roof data for the project, from the cache when present (calls are billed). */
export async function roofData(tx: Tx, projectId: string, at: LatLng | null): Promise<RoofData> {
  const cached = await tx.selectFrom("roof_data_cache").selectAll().where("project_id", "=", projectId).where("provider", "=", "google_solar").executeTakeFirst();
  if (cached) {
    return {
      status: cached.status as RoofData["status"],
      imageryQuality: cached.imagery_quality,
      insights: cached.status === "ok" ? ((cached.response as unknown as { insights?: BuildingInsights }).insights ?? null) : null,
      fetchedAt: cached.fetched_at,
    };
  }
  const maps = googleMaps();
  if (!maps) return { status: "not_configured", imageryQuality: null, insights: null, fetchedAt: null };
  if (!at) return { status: "no_position", imageryQuality: null, insights: null, fetchedAt: null };
  let status: "ok" | "no_coverage" | "error" = "error";
  let insights: BuildingInsights | null = null;
  let response: unknown = null;
  try {
    const r = await maps.buildingInsights(at);
    status = r.status;
    response = r.status === "ok" ? { insights: r.insights } : r.raw;
    if (r.status === "ok") insights = r.insights;
  } catch (err) {
    response = { error: err instanceof Error ? err.message : String(err) };
    console.error("Google Solar lookup failed", (response as { error: string }).error);
  }
  // Errors aren't cached, so a later visit retries; results and "no coverage" are.
  if (status !== "error") {
    await tx
      .insertInto("roof_data_cache")
      .values({ project_id: projectId, lat: at.lat, lng: at.lng, status, imagery_quality: insights?.imageryQuality ?? null, response: JSON.stringify(response) })
      .onConflict((oc) => oc.columns(["company_id", "project_id", "provider"]).doUpdateSet({ status, response: JSON.stringify(response), fetched_at: sql<Date>`now()` }))
      .execute();
  }
  return { status, imageryQuality: insights?.imageryQuality ?? null, insights, fetchedAt: new Date(), error: status === "error" ? String((response as { error?: string })?.error ?? "").slice(0, 300) || null : null };
}

/** A roof segment in the designer's terms: plan position, size along the ridge and up the slope. */
export interface DesignSegment {
  id: string;
  label: string;
  pitch: number;
  azimuth: number;
  /** Plan position of the segment centre, metres east/south of the site centre. */
  origin: { x: number; y: number };
  /** Length along the ridge (m) and up the slope on the roof plane (m). */
  width: number;
  depth: number;
  /** Hip insets at the ridge ends, metres (0 for a gable). */
  insetLeft: number;
  insetRight: number;
  panels: { x: number; y: number; w: number; h: number }[];
  obstructions: { x: number; y: number; w: number; h: number; label: string }[];
  landscape: boolean;
  shadeFactor: number;
  used: boolean;
  sunshineHours: number | null;
  suggestedPanels: number | null;
}

/**
 * Turn Solar API segments into editable rectangles: the plan bounding box is
 * oriented to the segment's azimuth and scaled to match its area.
 */
export function segmentsFromInsights(insights: BuildingInsights, centre: LatLng): DesignSegment[] {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return insights.segments
    .filter((s) => s.areaM2 >= 4)
    .map((s, i) => {
      const sw = toLocalMetres(centre, s.sw);
      const ne = toLocalMetres(centre, s.ne);
      const bw = Math.abs(ne.x - sw.x);
      const bh = Math.abs(sw.y - ne.y);
      const facingNS = Math.abs(Math.cos((s.azimuth * Math.PI) / 180)) >= Math.abs(Math.sin((s.azimuth * Math.PI) / 180));
      const cos = Math.cos((s.pitch * Math.PI) / 180) || 1;
      const planArea = s.areaM2 * cos;
      let width = facingNS ? bw : bh;
      let planDepth = facingNS ? bh : bw;
      const k = Math.sqrt(planArea / Math.max(0.1, width * planDepth));
      width *= k;
      planDepth *= k;
      const o = toLocalMetres(centre, s.center);
      const facing = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(s.azimuth / 45) % 8];
      return {
        id: letters[i] ?? `R${i + 1}`,
        label: `Roof ${letters[i] ?? i + 1} · ${facing}`,
        pitch: s.pitch,
        azimuth: s.azimuth,
        origin: { x: Math.round(o.x * 100) / 100, y: Math.round(o.y * 100) / 100 },
        width: Math.round(width * 100) / 100,
        depth: Math.round((planDepth / cos) * 100) / 100,
        insetLeft: 0,
        insetRight: 0,
        panels: [],
        obstructions: [],
        landscape: false,
        shadeFactor: 1,
        used: s.azimuth > 80 && s.azimuth < 280,
        sunshineHours: s.sunshineHours,
        suggestedPanels: insights.suggestedPanels[i] ?? null,
      };
    });
}
