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

// Estonian street names are very often spoken/written with the honoree's first name(s)
// abbreviated to initials ("J. Vilmsi", "A. H. Tammsaare tee"), but OSM/Nominatim usually
// indexes the street under its full name ("Jüri Vilmsi") — its tokenizer doesn't expand
// initials, so a query with them attached returns zero results even though the street exists.
// Stripping single-letter-plus-period tokens and retrying once recovers these (verified against
// several real Tallinn streets: "A. Lauteri" / "F. R. Faehlmanni" both fail, "Lauteri" /
// "Faehlmanni" both succeed).
function stripInitials(q: string): string {
  return q
    .split(/\s+/)
    .filter((token) => !/^\p{L}\.$/u.test(token))
    .join(" ")
    .trim();
}

async function queryNominatim(q: string): Promise<NominatimResult[] | null> {
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
    return null;
  }
  if (!res.ok) return null;
  return res.json();
}

export async function handleGeocode(
  request: Request,
  env: { GEOCODE_RATE_LIMITER?: RateLimit },
): Promise<Response> {
  // Keyed by IP, not per-user — this route is free/unauthenticated by design (see comment
  // above), so there's no account to key by, and the thing actually being protected is
  // Nominatim's shared ~1 req/sec policy for the Worker's whole egress IP, not any one caller.
  if (env.GEOCODE_RATE_LIMITER) {
    const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.GEOCODE_RATE_LIMITER.limit({ key: clientIp });
    if (!success) return Response.json({ error: "Too many requests — try again shortly" }, { status: 429 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) {
    return Response.json({ error: "Query must be between 3 and 120 characters" }, { status: 400 });
  }

  let results = await queryNominatim(q);
  if (results === null) {
    return Response.json({ error: "Geocoding service unavailable" }, { status: 502 });
  }

  if (results.length === 0) {
    const stripped = stripInitials(q);
    if (stripped.length >= MIN_QUERY_LENGTH && stripped !== q) {
      results = (await queryNominatim(stripped)) ?? results;
    }
  }

  const candidates: GeocodeCandidate[] = results.map((r) => ({
    label: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
  return Response.json(candidates);
}
