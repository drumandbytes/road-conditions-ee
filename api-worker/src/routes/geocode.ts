// Address search for the "add a saved point" flow — free, unauthenticated (cheap to run, and
// gating it behind a subscription would block a free user from even *previewing* the feature
// before deciding to subscribe).
//
// Deliberately NOT Tark Tee's own tram/geocoding_address ArcGIS service, despite every other
// data source in this app coming from there. Verified directly: findAddressCandidates on all
// three of its geocode services (geocoding_address, geocoding, geocoding_area) returns zero
// candidates for every query tried (street+number, city-only, with/without diacritics, with
// Referer/Origin headers matching tarktee.ee) — the locator index appears to be empty or to
// require an address format never discovered despite reasonable effort. Nominatim (OSM) is
// used instead: verified working, returns real results for Estonian addresses, no API key
// required. Usage policy (nominatim.org/release-docs/latest/api/Usage-Policy) requires a
// descriptive User-Agent and caps at ~1 request/second — fine for an on-demand,
// user-triggered search proxied through one Worker, not a bulk geocoding use case.
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "road-conditions-ee/1.0 (+https://roadconditions.drumandbytes.ee)";
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 120;

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

export interface GeocodeCandidate {
  label: string;
  lat: number;
  lng: number;
}

export async function handleGeocode(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) {
    return Response.json({ error: "Query must be between 3 and 120 characters" }, { status: 400 });
  }

  const nominatimUrl = new URL(NOMINATIM_URL);
  nominatimUrl.searchParams.set("q", q);
  nominatimUrl.searchParams.set("format", "jsonv2");
  nominatimUrl.searchParams.set("countrycodes", "ee");
  nominatimUrl.searchParams.set("limit", "5");

  let res: Response;
  try {
    res = await fetch(nominatimUrl, { headers: { "User-Agent": USER_AGENT } });
  } catch (err) {
    console.error("[api-worker] geocode fetch failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Geocoding service unavailable" }, { status: 502 });
  }
  if (!res.ok) {
    return Response.json({ error: "Geocoding service unavailable" }, { status: 502 });
  }

  const results = (await res.json()) as NominatimResult[];
  const candidates: GeocodeCandidate[] = results.map((r) => ({
    label: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
  return Response.json(candidates);
}
