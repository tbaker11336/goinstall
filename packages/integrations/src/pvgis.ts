/**
 * PVGIS (EU JRC) PVcalc: monthly generation for one array, used as a
 * cross-check and for the monthly chart. The MCS figure is the one quoted.
 * https://joint-research-centre.ec.europa.eu/pvgis-online-tool/getting-started-pvgis/api-non-interactive-service_en
 */

export interface PvgisArray {
  lat: number;
  lon: number;
  kWp: number;
  /** Roof pitch, degrees from horizontal. */
  pitch: number;
  /** Degrees clockwise from north (converted to PVGIS's south-based aspect). */
  azimuth: number;
  /** System losses, percent. PVGIS's own default is 14. */
  lossPct: number;
}

export interface PvgisResult {
  annualKwh: number;
  monthlyKwh: number[];
}

export interface PvgisClient {
  pvcalc(a: PvgisArray): Promise<PvgisResult>;
}

/** PVGIS aspect: 0 = south, -90 = east, 90 = west. */
export function pvgisAspect(azimuth: number): number {
  const a = ((((azimuth - 180) % 360) + 540) % 360) - 180;
  return Math.round(a);
}

export function createPvgisClient({ fetch: fetchImpl = fetch, baseUrl = "https://re.jrc.ec.europa.eu/api/v5_3" } = {}): PvgisClient {
  return {
    async pvcalc(a) {
      const params = new URLSearchParams({
        lat: a.lat.toFixed(5),
        lon: a.lon.toFixed(5),
        peakpower: String(a.kWp),
        loss: String(a.lossPct),
        angle: String(Math.round(a.pitch)),
        aspect: String(pvgisAspect(a.azimuth)),
        outputformat: "json",
      });
      const res = await fetchImpl(`${baseUrl}/PVcalc?${params}`);
      if (!res.ok) throw new Error(`PVGIS returned ${res.status}`);
      const body = (await res.json()) as { outputs?: { monthly?: { fixed?: { month: number; E_m: number }[] }; totals?: { fixed?: { E_y: number } } } };
      const monthly = body.outputs?.monthly?.fixed;
      const annual = body.outputs?.totals?.fixed?.E_y;
      if (!monthly || annual === undefined) throw new Error("PVGIS response had no results");
      return { annualKwh: Math.round(annual), monthlyKwh: monthly.sort((x, y) => x.month - y.month).map((m) => Math.round(m.E_m)) };
    },
  };
}
