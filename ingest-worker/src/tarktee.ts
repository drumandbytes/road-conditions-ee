// Fetch/parse layer for Tark Tee's public endpoints.
//
// IMPORTANT: Tark Tee's server has a bug where gzip compression interacts badly with
// chunked transfer-encoding, breaking any client that requests gzip by default (curl,
// fetch()'s default Accept-Encoding). Confirmed directly against the real Cloudflare edge
// during Phase 0 — the fix is to always send Accept-Encoding: identity. Do not remove this
// header from any fetch() call in this file.
const TARKTEE_HEADERS = {
  "User-Agent": "road-conditions-ee (personal project, contact via tarktee.ee registration)",
  "Accept-Encoding": "identity",
};

const BASE = "https://tarktee.ee/api/v1";

export interface CameraMeta {
  id: string; // UUID — see fetchCamerasMetadata for why this differs from weather_stations' numeric id
  name: string;
  lat: number;
  lng: number;
  imageUrl: string;
}

async function fetchText(url: string, extraHeaders?: Record<string, string>): Promise<string> {
  const res = await fetch(url, { headers: { ...TARKTEE_HEADERS, ...extraHeaders } });
  if (!res.ok) {
    throw new Error(`Tark Tee request failed: ${url} -> ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// IMPORTANT: the JSON "toorandmed" endpoint (/import/public/tap/stations/road-camera/metadata)
// looked promising in Phase 0 (a 2-entry sample suggested ~half had real coordinates), but a
// full production run revealed EVERY one of its 151 entries has geometry: null — it's not a
// usable source of camera locations at all, contrary to that early (too-small) sample.
//
// Real camera locations (and live images!) come from the DATEX II 3.6 "roadCameraLocations"
// feed (XML, PredefinedLocationsPublication per the official Tark Tee DATEX II profile doc,
// section 6.10) — confirmed working for all 178 cameras, each with real coordinates AND a
// _predefinedLocationExtension/roadCameraLocationExtension/urlLink/urlLinkAddress giving the
// current live image URL (filename embeds a timestamp, confirmed genuinely live, not static).
// Same UUID scheme as the older DATEX II 2.3 version of this feed we used before switching —
// this 3.6 version is a strict superset (same 178 entries, same IDs, plus the image URL), so
// there's no longer an ID-matching problem between "camera locations" and "camera images" —
// they're the same row now. Requires NO API key despite being a DATEX II feed (same as the
// 2.3 version — the doc says all DATEX II feeds require one; this one just isn't enforced in
// practice, don't rely on that continuing).
export async function fetchCamerasMetadata(): Promise<CameraMeta[]> {
  // This endpoint content-negotiates between XML and JSON, and its default (no Accept header)
  // is NOT stable across environments — confirmed directly: curl from this machine defaults to
  // XML, but a deployed Cloudflare Worker with otherwise-identical headers got JSON back instead
  // (silently breaking this XML regex parser, real production bug, not hypothetical). Always
  // force XML explicitly rather than relying on whatever the server picks by default.
  const xml = await fetchText(`${BASE}/datex/v3.6/roadCameraLocations`, { Accept: "application/xml" });
  const cameras: CameraMeta[] = [];
  const entryPattern = /<ns4:predefinedLocationReference[^>]*id="([^"]+)"[^>]*>(.*?)<\/ns4:predefinedLocationReference>/gs;
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(xml)) !== null) {
    const [, id, body] = match;
    const nameMatch = body.match(/<ns2:value lang="et">([^<]*)<\/ns2:value>/) ?? body.match(/<ns2:value[^>]*>([^<]*)<\/ns2:value>/);
    const latMatch = body.match(/<ns4:latitude>([^<]+)<\/ns4:latitude>/);
    const lngMatch = body.match(/<ns4:longitude>([^<]+)<\/ns4:longitude>/);
    const imageUrlMatch = body.match(/<ns2:urlLinkAddress>([^<]+)<\/ns2:urlLinkAddress>/);
    if (!nameMatch || !latMatch || !lngMatch || !imageUrlMatch) continue; // skip malformed entries rather than fail the whole feed
    cameras.push({
      id,
      name: nameMatch[1],
      lat: parseFloat(latMatch[1]),
      lng: parseFloat(lngMatch[1]),
      imageUrl: imageUrlMatch[1],
    });
  }
  // A genuinely empty result is very unlikely (178 cameras, confirmed working) — a non-trivial
  // response producing zero parsed entries means Tark Tee changed its XML schema (namespace
  // prefix, element structure) and this regex parser silently broke, not "no cameras today."
  if (cameras.length === 0 && xml.length > 500) {
    console.error(
      `[ingest-worker] fetchCamerasMetadata: parsed 0 cameras from a ${xml.length}-byte response — the upstream XML schema may have changed`,
    );
  }
  return cameras;
}

// DATEX II SRTI hazard feed types. API key approved and wired in as a secret
// (TARKTEE_API_KEY). Individual endpoints do occasionally 502 from Tark Tee's own gateway —
// see fetchAllHazards's own comment for why that no longer takes the other feeds down with it.
export type HazardEventType =
  | "slippery"
  | "obstacle"
  | "accident"
  | "roadworks"
  | "reduced_visibility"
  | "blockage"
  | "weather";

const SRTI_ENDPOINTS: Record<HazardEventType, string> = {
  slippery: "srti/temporarySlipperyRoad",
  obstacle: "srti/animalObstacle",
  accident: "srti/unprotectedAccident",
  roadworks: "srti/shortTermRoadWorks",
  reduced_visibility: "srti/reducedVisibility",
  blockage: "srti/unmanagedBlockage",
  weather: "srti/exceptionalWeather",
};

export interface HazardRecord {
  externalId: string;
  eventType: HazardEventType;
  lat: number;
  lng: number;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  rawJson: string;
}

// Confirmed against a real production payload (a "shortTermRoadWorks" record, 2026-07-26) —
// the coordinates live at locationReference.pointByCoordinates.pointCoordinates, NOT at
// groupOfLocations.locationForDisplay as originally guessed from the general DATEX II 3.6 SRTI
// standard. That wrong guess was silently discarding every real hazard record until fixed; see
// fetchAllHazards's own comment for the logging that caught it.
interface DatexSituation {
  id: string;
  situationRecord?: Array<{
    id?: string;
    validity?: { validityTimeSpecification?: { overallStartTime?: string; overallEndTime?: string } };
    locationReference?: {
      pointByCoordinates?: {
        pointCoordinates?: { latitude?: number; longitude?: number };
      };
    };
    generalPublicComment?: Array<{ comment?: { values?: Array<{ value?: string; lang?: string }> } }>;
  }>;
}

interface DatexSrtiResponse {
  situation: DatexSituation[];
  lang: string;
}

// `skipped` carries the raw JSON of anything dropped by the location/id checks below, surfaced
// once per poll cycle by fetchAllHazards rather than logged individually per feed. Kept as an
// ongoing safety net, not just a one-off diagnostic — DatexSituation's location field was
// wrong for months despite looking reasonable (see its own comment), and the 7 SRTI endpoints
// cover different DATEX II situation subtypes that could still vary at the edges.
interface HazardFetchResult {
  records: HazardRecord[];
  situationCount: number;
  skipped: Array<{ reason: string; raw: string }>;
}

// Requires the DATEX II API key, sent via the X-DATEX-API-KEY header — confirmed from Tark
// Tee's own "DATEX II Estonian profile" PDF (section 7, "Accessing feeds"). Note this was
// initially guessed wrong as "X-API-Key" before reading that doc; verify header names against
// primary sources rather than assuming REST conventions apply.
export async function fetchHazards(
  apiKey: string | undefined,
  eventType: HazardEventType,
): Promise<HazardFetchResult> {
  if (!apiKey) {
    // No key yet — return empty rather than fail the whole poll cycle over one feed type.
    return { records: [], situationCount: 0, skipped: [] };
  }
  const url = `${BASE}/datex/${SRTI_ENDPOINTS[eventType]}`;
  const res = await fetch(url, {
    headers: { ...TARKTEE_HEADERS, "X-DATEX-API-KEY": apiKey },
  });
  if (!res.ok) {
    throw new Error(`Tark Tee SRTI request failed: ${url} -> ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as DatexSrtiResponse;
  const records: HazardRecord[] = [];
  const skipped: HazardFetchResult["skipped"] = [];
  for (const situation of data.situation ?? []) {
    if (!situation.situationRecord || situation.situationRecord.length === 0) {
      skipped.push({ reason: "no-situation-record", raw: JSON.stringify(situation) });
      continue;
    }
    for (const record of situation.situationRecord) {
      const loc = record.locationReference?.pointByCoordinates?.pointCoordinates;
      if (!loc || loc.latitude === undefined || loc.longitude === undefined) {
        skipped.push({ reason: "no-location", raw: JSON.stringify(record) });
        continue;
      }
      // externalId is a NOT NULL primary key in D1. record.id is confirmed present on real
      // payloads (see this interface's own comment above); situation.id is kept as a fallback
      // regardless, since a runtime-missing id must be skipped here rather than reaching db.ts
      // as `undefined` and failing the entire batch write for every hazard type fetched this
      // cycle, not just this one record.
      const externalId = record.id ?? situation.id;
      if (!externalId) {
        skipped.push({ reason: "no-id", raw: JSON.stringify(record) });
        continue;
      }
      const commentValues = record.generalPublicComment?.[0]?.comment?.values ?? [];
      const description = commentValues.find((v) => v.lang === "et")?.value ?? commentValues[0]?.value ?? null;
      records.push({
        externalId,
        eventType,
        lat: loc.latitude,
        lng: loc.longitude,
        description,
        startsAt: record.validity?.validityTimeSpecification?.overallStartTime ?? null,
        endsAt: record.validity?.validityTimeSpecification?.overallEndTime ?? null,
        rawJson: JSON.stringify(record),
      });
    }
  }
  return { records, situationCount: data.situation?.length ?? 0, skipped };
}

// allSettled, not all — the 7 SRTI endpoints are independent feeds (confirmed in production:
// animalObstacle alone returning a 502 from Tark Tee's own gateway was silently discarding the
// other 6 endpoints' real data every single poll, via Promise.all's all-or-nothing rejection,
// leaving the hazards table permanently empty despite most feeds working fine). One endpoint
// being down is Tark Tee's problem, not a reason to also lose everyone else's hazard data.
//
// Logs exactly once per poll cycle (one combined structured line covering all 7 feeds) rather
// than once per feed — Workers Logs bills/counts per log event, and 7+ separate lines every 3
// minutes adds up fast for no benefit over one line with the same information.
export async function fetchAllHazards(apiKey: string | undefined): Promise<HazardRecord[]> {
  const eventTypes = Object.keys(SRTI_ENDPOINTS) as HazardEventType[];
  const results = await Promise.allSettled(eventTypes.map((type) => fetchHazards(apiKey, type)));
  const records: HazardRecord[] = [];
  const summary: Record<string, unknown> = {};
  let hasIssue = false;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const eventType = eventTypes[i];
    if (result.status === "fulfilled") {
      records.push(...result.value.records);
      summary[eventType] = {
        situations: result.value.situationCount,
        usable: result.value.records.length,
        ...(result.value.skipped.length > 0 && { skipped: result.value.skipped }),
      };
      if (result.value.skipped.length > 0) hasIssue = true;
    } else {
      summary[eventType] = { error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
      hasIssue = true;
    }
  }
  const log = hasIssue ? console.error : console.log;
  log("[ingest-worker] hazard poll:", JSON.stringify(summary));
  return records;
}
