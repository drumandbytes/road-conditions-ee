// Fetch/parse layer for the ArcGIS REST services behind Tark Tee's own map UI
// (tarktee.ee/tarktee/rest/services/tram/*). Found by inspecting the official map's network
// traffic — undocumented and not part of the registered DATEX II feeds, but unauthenticated
// and clearly meant to serve map clients. Carries real sensor readings (temp, grip, wind) and
// the broad roadworks/closures dataset that DATEX II's SRTI feeds don't cover (SRTI is scoped
// to formal safety situations — accidents, slippery-road warnings — which is why it's
// legitimately near-empty most of the time; see tarktee.ts's fetchAllHazards).
import proj4 from "proj4";

const ARCGIS_BASE = "https://tarktee.ee/tarktee/rest/services/tram";
const HEADERS = {
  "User-Agent": "road-conditions-ee (personal project, contact via tarktee.ee registration)",
  "Accept-Encoding": "identity",
};

// EPSG:3301 "Estonian Coordinate System of 1997" (L-EST97) — this ArcGIS server always
// returns geometry in its native SR regardless of outSR/f=geojson params (confirmed directly:
// both were tried and ignored). Verified this exact proj4 definition against a known point
// (Aranküla weather station, cross-checked against its WGS84 coordinates from the existing
// DATEX-sourced dataset) — transformed within ~11m of the known value, well within tolerance.
const EPSG_3301 =
  "+proj=lcc +lat_1=58 +lat_2=59.33333333333333 +lat_0=57.51755393055556 +lon_0=24 +x_0=500000 +y_0=6375000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
const toWgs84 = proj4(EPSG_3301, "WGS84");

function transformCoords(x: number, y: number): { lat: number; lng: number } {
  const [lng, lat] = toWgs84.forward([x, y]);
  return { lat, lng };
}

interface ArcGisFeature<A> {
  attributes: A;
  geometry: { x: number; y: number } | null;
}

interface ArcGisQueryResponse<A> {
  features: ArcGisFeature<A>[];
  exceededTransferLimit?: boolean;
}

async function fetchArcGisJson<A>(url: string): Promise<ArcGisQueryResponse<A>> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`ArcGIS request failed: ${url} -> ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<ArcGisQueryResponse<A>>;
}

export interface WeatherReading {
  id: number;
  name: string;
  lat: number;
  lng: number;
  roadStatus: string | null;
  roadStatusAggregate: string | null;
  roadTemp: number | null;
  airTemp: number | null;
  precipitationType: string | null;
  precipitationIntensity: number | null;
  windDir: number | null;
  windSpeed: number | null;
  airHumidity: number | null;
  visibility: number | null;
  gripFactor: number | null;
  measurementTime: string | null; // ISO, converted from the feed's epoch ms
}

interface WeatherStationAttributes {
  objectid: number;
  site_name: string;
  road_status_aggregate: string | null;
  road_status: string | null;
  road_temp: number | null;
  air_temp: number | null;
  precipitation_type: string | null;
  precipitation_intensity: number | null;
  wind_dir: number | null;
  wind_speed: number | null;
  air_humidity: number | null;
  visibility: number | null;
  measurement_time: number | null;
  grip_factor: number | null;
}

export async function fetchWeatherReadings(): Promise<WeatherReading[]> {
  const url = `${ARCGIS_BASE}/road_weather_stations/MapServer/0/query?f=json&outFields=*&where=1=1`;
  const data = await fetchArcGisJson<WeatherStationAttributes>(url);
  return data.features
    .filter((f) => f.geometry !== null)
    .map((f) => {
      const { lat, lng } = transformCoords(f.geometry!.x, f.geometry!.y);
      const a = f.attributes;
      return {
        id: a.objectid,
        name: a.site_name,
        lat,
        lng,
        roadStatus: a.road_status,
        roadStatusAggregate: a.road_status_aggregate,
        roadTemp: a.road_temp,
        airTemp: a.air_temp,
        precipitationType: a.precipitation_type,
        precipitationIntensity: a.precipitation_intensity,
        windDir: a.wind_dir,
        windSpeed: a.wind_speed,
        airHumidity: a.air_humidity,
        visibility: a.visibility,
        gripFactor: a.grip_factor,
        measurementTime: a.measurement_time ? new Date(a.measurement_time).toISOString() : null,
      };
    });
}

export interface Restriction {
  id: number;
  roadNr: number | null;
  roadName: string | null;
  roadType: string | null;
  cause: string | null;
  effect: string | null;
  extraInfo: string | null;
  detourComment: string | null;
  contractorOrganization: string | null;
  contractorContactPhone: string | null;
  trafficCtrlOrganization: string | null;
  trafficCtrlContactPhone: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  lat: number;
  lng: number;
}

interface RestrictionAttributes {
  objectid: number;
  road_nr: number | null;
  road_name: string | null;
  road_type: string | null;
  cause: string | null;
  effect: string | null;
  extra_info: string | null;
  detour_comment: string | null;
  contractor_organization: string | null;
  contractor_contact_phone: string | null;
  traffic_ctrl_organization: string | null;
  traffic_ctrl_contact_phone: string | null;
  date_from: number | null;
  date_to: number | null;
}

const ARCGIS_PAGE_SIZE = 1000;

// Mirrors the exact where-clause Tark Tee's own map sends for this layer (captured from its
// network traffic) — restrictions that haven't ended yet, and start within the next week
// (so upcoming scheduled works show up, without pulling in the entire multi-year historical
// archive this layer also contains — real entries in it go back to 2017).
function activeRestrictionsWhereClause(): string {
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nowStr = now.toISOString().slice(0, 19).replace("T", " ");
  const weekOutStr = weekOut.toISOString().slice(0, 10);
  return `(date_from is null or date_from < '${weekOutStr}') and (date_to is null or date_to >= '${nowStr}')`;
}

async function fetchRestrictionsPage(offset: number): Promise<ArcGisQueryResponse<RestrictionAttributes>> {
  const params = new URLSearchParams({
    f: "json",
    outFields: "*",
    where: activeRestrictionsWhereClause(),
    resultOffset: String(offset),
    resultRecordCount: String(ARCGIS_PAGE_SIZE),
  });
  return fetchArcGisJson<RestrictionAttributes>(`${ARCGIS_BASE}/restrictions_traffic/MapServer/0/query?${params}`);
}

export async function fetchRestrictions(): Promise<Restriction[]> {
  const restrictions: Restriction[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchRestrictionsPage(offset);
    for (const f of page.features) {
      if (!f.geometry) continue;
      const { lat, lng } = transformCoords(f.geometry.x, f.geometry.y);
      const a = f.attributes;
      restrictions.push({
        id: a.objectid,
        roadNr: a.road_nr,
        roadName: a.road_name,
        roadType: a.road_type,
        cause: a.cause,
        effect: a.effect,
        extraInfo: a.extra_info,
        detourComment: a.detour_comment,
        contractorOrganization: a.contractor_organization,
        contractorContactPhone: a.contractor_contact_phone,
        trafficCtrlOrganization: a.traffic_ctrl_organization,
        trafficCtrlContactPhone: a.traffic_ctrl_contact_phone,
        dateFrom: a.date_from ? new Date(a.date_from).toISOString() : null,
        dateTo: a.date_to ? new Date(a.date_to).toISOString() : null,
        lat,
        lng,
      });
    }
    if (!page.exceededTransferLimit || page.features.length < ARCGIS_PAGE_SIZE) break;
    offset += ARCGIS_PAGE_SIZE;
  }
  return restrictions;
}

export interface Detour {
  id: number;
  restrictionId: number | null;
  description: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

interface DetourAttributes {
  objectid: number;
  restriction_id: number | null;
  description: string | null;
  date_from: number | null;
  date_to: number | null;
}

async function fetchDetoursPage(offset: number): Promise<ArcGisQueryResponse<DetourAttributes>> {
  const params = new URLSearchParams({
    f: "json",
    outFields: "*",
    // Same active-window filter as restrictions — this layer holds the same kind of
    // multi-year archive (entries back to 2017), and detours only matter tied to a
    // currently-active restriction anyway.
    where: activeRestrictionsWhereClause(),
    resultOffset: String(offset),
    resultRecordCount: String(ARCGIS_PAGE_SIZE),
  });
  return fetchArcGisJson<DetourAttributes>(`${ARCGIS_BASE}/detours/MapServer/0/query?${params}`);
}

// No geometry parsed here — detours describe the same location as the restriction they're
// tied to (restriction_id), so api-worker joins them onto the restriction row rather than
// this becoming a second set of map markers at (near-)duplicate positions.
export async function fetchDetours(): Promise<Detour[]> {
  const detours: Detour[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchDetoursPage(offset);
    for (const f of page.features) {
      const a = f.attributes;
      detours.push({
        id: a.objectid,
        restrictionId: a.restriction_id,
        description: a.description,
        dateFrom: a.date_from ? new Date(a.date_from).toISOString() : null,
        dateTo: a.date_to ? new Date(a.date_to).toISOString() : null,
      });
    }
    if (!page.exceededTransferLimit || page.features.length < ARCGIS_PAGE_SIZE) break;
    offset += ARCGIS_PAGE_SIZE;
  }
  return detours;
}

export interface VmsSign {
  id: number;
  roadNr: number | null;
  roadName: string | null;
  roadKm: number | null;
  angle: number | null;
  speedLimit: number | null;
  speedLimitChangedAt: string | null;
  warning: string | null;
  warningChangedAt: string | null;
  lat: number;
  lng: number;
}

interface VmsSignAttributes {
  objectid: number;
  road_nr: number | null;
  road_name: string | null;
  road_km: number | null;
  angle: number | null;
  speed_limit: number | null;
  speed_limit_changed_at: number | null;
  warning: string | null;
  warning_changed_at: number | null;
}

// This layer's declared count (returnCountOnly) says 180, but only 150 are actually
// retrievable via query regardless of ordering/offset — confirmed directly, the same
// count-vs-query discrepancy already hit once this session with the old broken camera
// metadata endpoint (which counted 151 entries that all had null geometry). Not chasing the
// phantom 30 here; 150 is the real, usable dataset.
//
// Page size is 50, not the shared ARCGIS_PAGE_SIZE — confirmed directly that this specific
// layer silently caps at 100 regardless of a larger resultRecordCount request, and pagination
// past that point returns 0 rather than the remainder. 50 was verified to page correctly
// across the full dataset with resultOffset. orderByFields=objectid keeps page boundaries
// deterministic across separate requests.
const VMS_PAGE_SIZE = 50;

async function fetchVmsSignsPage(offset: number): Promise<ArcGisQueryResponse<VmsSignAttributes>> {
  const params = new URLSearchParams({
    f: "json",
    outFields: "*",
    where: "1=1",
    orderByFields: "objectid",
    resultOffset: String(offset),
    resultRecordCount: String(VMS_PAGE_SIZE),
  });
  return fetchArcGisJson<VmsSignAttributes>(`${ARCGIS_BASE}/vms_traffic_signs/MapServer/0/query?${params}`);
}

export async function fetchVmsSigns(): Promise<VmsSign[]> {
  const signs: VmsSign[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchVmsSignsPage(offset);
    for (const f of page.features) {
      if (!f.geometry) continue;
      const { lat, lng } = transformCoords(f.geometry.x, f.geometry.y);
      const a = f.attributes;
      signs.push({
        id: a.objectid,
        roadNr: a.road_nr,
        roadName: a.road_name,
        roadKm: a.road_km,
        angle: a.angle,
        speedLimit: a.speed_limit,
        speedLimitChangedAt: a.speed_limit_changed_at ? new Date(a.speed_limit_changed_at).toISOString() : null,
        warning: a.warning,
        warningChangedAt: a.warning_changed_at ? new Date(a.warning_changed_at).toISOString() : null,
        lat,
        lng,
      });
    }
    if (page.features.length < VMS_PAGE_SIZE) break;
    offset += VMS_PAGE_SIZE;
  }
  return signs;
}
