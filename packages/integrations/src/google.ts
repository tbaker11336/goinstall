/**
 * Google Maps Platform: geocoding, the Solar API (buildingInsights) and
 * Static Maps aerial images. The key stays server-side; images are proxied.
 * Solar API calls are billed, so callers cache responses per project.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoofSegment {
  /** Roof pitch, degrees. */
  pitch: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  areaM2: number;
  center: LatLng;
  sw: LatLng;
  ne: LatLng;
  /** Median annual sunshine hours on this segment, for the shading view. */
  sunshineHours: number | null;
}

export interface BuildingInsights {
  imageryQuality: string | null;
  center: LatLng;
  segments: RoofSegment[];
  /** Largest suggested layout's panel count per segment index. */
  suggestedPanels: Record<number, number>;
  maxPanels: number | null;
}

export type SolarLookup = { status: "ok"; insights: BuildingInsights; raw: unknown } | { status: "no_coverage"; raw: unknown };

export interface GoogleMapsClient {
  geocode(address: string): Promise<LatLng | null>;
  buildingInsights(at: LatLng): Promise<SolarLookup>;
  /** Satellite image URL including the key: fetch it server-side only. */
  staticMapUrl(center: LatLng, opts?: { zoom?: number; size?: number }): string;
}

/** Metres per pixel of a Web Mercator map at this zoom and latitude (scale 1). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** Local east/south offset in metres from an origin (fine at house scale). */
export function toLocalMetres(origin: LatLng, p: LatLng): { x: number; y: number } {
  const R = 6378137;
  const x = ((p.lng - origin.lng) * Math.PI * R * Math.cos((origin.lat * Math.PI) / 180)) / 180;
  const y = (-(p.lat - origin.lat) * Math.PI * R) / 180;
  return { x, y };
}

interface SolarResponse {
  imageryQuality?: string;
  center?: { latitude: number; longitude: number };
  solarPotential?: {
    maxArrayPanelsCount?: number;
    roofSegmentStats?: {
      pitchDegrees?: number;
      azimuthDegrees?: number;
      stats?: { areaMeters2?: number; sunshineQuantiles?: number[] };
      center?: { latitude: number; longitude: number };
      boundingBox?: { sw: { latitude: number; longitude: number }; ne: { latitude: number; longitude: number } };
    }[];
    solarPanelConfigs?: { panelsCount: number; roofSegmentSummaries?: { segmentIndex: number; panelsCount: number }[] }[];
  };
  error?: { code: number; status: string; message: string };
}

const ll = (p?: { latitude: number; longitude: number }): LatLng => ({ lat: p?.latitude ?? 0, lng: p?.longitude ?? 0 });

export function parseBuildingInsights(body: SolarResponse): BuildingInsights {
  const sp = body.solarPotential ?? {};
  const segments = (sp.roofSegmentStats ?? []).map((s) => {
    const q = s.stats?.sunshineQuantiles;
    return {
      pitch: Math.round((s.pitchDegrees ?? 0) * 10) / 10,
      azimuth: Math.round((s.azimuthDegrees ?? 180) * 10) / 10,
      areaM2: Math.round((s.stats?.areaMeters2 ?? 0) * 10) / 10,
      center: ll(s.center),
      sw: ll(s.boundingBox?.sw),
      ne: ll(s.boundingBox?.ne),
      sunshineHours: q?.length ? Math.round(q[Math.floor(q.length / 2)]!) : null,
    };
  });
  const biggest = [...(sp.solarPanelConfigs ?? [])].sort((a, b) => b.panelsCount - a.panelsCount)[0];
  const suggestedPanels: Record<number, number> = {};
  for (const s of biggest?.roofSegmentSummaries ?? []) suggestedPanels[s.segmentIndex] = s.panelsCount;
  return { imageryQuality: body.imageryQuality ?? null, center: ll(body.center), segments, suggestedPanels, maxPanels: sp.maxArrayPanelsCount ?? null };
}

export function createGoogleMapsClient({ apiKey, fetch: fetchImpl = fetch }: { apiKey: string; fetch?: typeof fetch }): GoogleMapsClient {
  return {
    async geocode(address) {
      const res = await fetchImpl(`https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ address, region: "uk", key: apiKey })}`);
      const body = (await res.json()) as { status: string; results?: { geometry: { location: LatLng } }[]; error_message?: string };
      if (body.status === "ZERO_RESULTS") return null;
      if (body.status !== "OK") throw new Error(`Geocoding failed: ${body.error_message ?? body.status}`);
      return body.results![0]!.geometry.location;
    },
    async buildingInsights(at) {
      const params = new URLSearchParams({ "location.latitude": at.lat.toFixed(6), "location.longitude": at.lng.toFixed(6), requiredQuality: "MEDIUM", key: apiKey });
      const res = await fetchImpl(`https://solar.googleapis.com/v1/buildingInsights:findClosest?${params}`);
      const body = (await res.json()) as SolarResponse;
      // 404 means no coverage at that quality: fall back to drawing the roof.
      if (res.status === 404 || body.error?.status === "NOT_FOUND") return { status: "no_coverage", raw: body };
      if (!res.ok) throw new Error(`Solar API: ${body.error?.message ?? res.status}`);
      return { status: "ok", insights: parseBuildingInsights(body), raw: body };
    },
    staticMapUrl(center, { zoom = 20, size = 640 } = {}) {
      return `https://maps.googleapis.com/maps/api/staticmap?${new URLSearchParams({
        center: `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`,
        zoom: String(zoom),
        size: `${size}x${size}`,
        scale: "2",
        maptype: "satellite",
        key: apiKey,
      })}`;
    },
  };
}
