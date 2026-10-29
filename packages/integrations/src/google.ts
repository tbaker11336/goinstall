/**
 * Google Maps Platform: geocoding, address suggestions (Places API), the
 * Solar API (buildingInsights) and Static Maps aerial images. The key stays server-side; images are proxied.
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
  /** When the aerial imagery was taken (YYYY-MM-DD). */
  imageryDate: string | null;
  /** Google's regional grid carbon factor, kg CO2 per MWh. */
  carbonOffsetKgPerMwh: number | null;
  /** Panel size Google's layouts assume, watts. */
  panelCapacityWatts: number | null;
  /** Google's layouts: panel count and estimated yearly DC energy. */
  configs: { panelsCount: number; yearlyEnergyDcKwh: number }[];
  center: LatLng;
  segments: RoofSegment[];
  /** Largest suggested layout's panel count per segment index. */
  suggestedPanels: Record<number, number>;
  maxPanels: number | null;
}

export type SolarLookup = { status: "ok"; insights: BuildingInsights; raw: unknown } | { status: "no_coverage"; raw: unknown };

/** One address in the search dropdown. */
export interface AddressSuggestion {
  placeId: string;
  /** e.g. "18 Rotherfield Road". */
  main: string;
  /** e.g. "Bristol, UK". */
  secondary: string;
}

export interface GoogleMapsClient {
  geocode(address: string): Promise<LatLng | null>;
  /**
   * UK address suggestions as the user types. Google bills the typing and the
   * chosen place's lookup as one session when both carry the same token.
   */
  autocomplete(input: string, sessionToken: string): Promise<AddressSuggestion[]>;
  placeLocation(placeId: string, sessionToken?: string): Promise<{ at: LatLng; address: string } | null>;
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
  imageryDate?: { year: number; month: number; day: number };
  center?: { latitude: number; longitude: number };
  solarPotential?: {
    maxArrayPanelsCount?: number;
    panelCapacityWatts?: number;
    carbonOffsetFactorKgPerMwh?: number;
    roofSegmentStats?: {
      pitchDegrees?: number;
      azimuthDegrees?: number;
      stats?: { areaMeters2?: number; sunshineQuantiles?: number[] };
      center?: { latitude: number; longitude: number };
      boundingBox?: { sw: { latitude: number; longitude: number }; ne: { latitude: number; longitude: number } };
    }[];
    solarPanelConfigs?: { panelsCount: number; yearlyEnergyDcKwh?: number; roofSegmentSummaries?: { segmentIndex: number; panelsCount: number }[] }[];
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
  const d = body.imageryDate;
  return {
    imageryQuality: body.imageryQuality ?? null,
    imageryDate: d?.year ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day || 1).padStart(2, "0")}` : null,
    carbonOffsetKgPerMwh: sp.carbonOffsetFactorKgPerMwh ?? null,
    panelCapacityWatts: sp.panelCapacityWatts ?? null,
    configs: (sp.solarPanelConfigs ?? []).filter((c) => c.yearlyEnergyDcKwh).map((c) => ({ panelsCount: c.panelsCount, yearlyEnergyDcKwh: Math.round(c.yearlyEnergyDcKwh!) })),
    center: ll(body.center),
    segments,
    suggestedPanels,
    maxPanels: sp.maxArrayPanelsCount ?? null,
  };
}

/**
 * Google's own yearly DC estimate for a layout of this size, scaled from its
 * nearest layout to the designed panel count and wattage. A cross-check
 * beside the MCS figure (which stays the headline), not a replacement.
 */
export function googleYearlyEstimateKwh(insights: Pick<BuildingInsights, "configs" | "panelCapacityWatts">, panelCount: number, panelWatts: number): number | null {
  // Older cached responses have no configs.
  if (!panelCount || !panelWatts || !insights.configs?.length || !insights.panelCapacityWatts) return null;
  const nearest = [...insights.configs].sort((a, b) => Math.abs(a.panelsCount - panelCount) - Math.abs(b.panelsCount - panelCount))[0]!;
  const perPanelWatt = nearest.yearlyEnergyDcKwh / (nearest.panelsCount * insights.panelCapacityWatts);
  return Math.round(perPanelWatt * panelCount * panelWatts);
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
    async autocomplete(input, sessionToken) {
      const res = await fetchImpl("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
        body: JSON.stringify({ input, sessionToken, includedRegionCodes: ["gb"], languageCode: "en-GB" }),
      });
      const body = (await res.json()) as {
        suggestions?: { placePrediction?: { placeId: string; text?: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[];
        error?: { message: string };
      };
      if (!res.ok) throw new Error(`Places API: ${body.error?.message ?? res.status}`);
      return (body.suggestions ?? []).flatMap(({ placePrediction: p }) =>
        p ? [{ placeId: p.placeId, main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "", secondary: p.structuredFormat?.secondaryText?.text ?? "" }] : [],
      );
    },
    async placeLocation(placeId, sessionToken) {
      const q = sessionToken ? `?${new URLSearchParams({ sessionToken })}` : "";
      const res = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${q}`, {
        headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "location,formattedAddress" },
      });
      const body = (await res.json()) as { location?: { latitude: number; longitude: number }; formattedAddress?: string; error?: { status?: string; message: string } };
      if (res.status === 404 || body.error?.status === "NOT_FOUND") return null;
      if (!res.ok) throw new Error(`Places API: ${body.error?.message ?? res.status}`);
      if (!body.location) return null;
      return { at: { lat: body.location.latitude, lng: body.location.longitude }, address: body.formattedAddress ?? "" };
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
