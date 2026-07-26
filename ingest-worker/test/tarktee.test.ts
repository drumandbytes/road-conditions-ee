import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllHazards, fetchCamerasMetadata, fetchHazards } from "../src/tarktee";

// Structure captured from a real Tark Tee response (see tarktee.ts's fetchCamerasMetadata
// comment) — the "Lokuti"/"Nõva" entries, coordinates, and image URL format are real; this
// is a trimmed excerpt of a real ~200KB response, not the full 178-camera payload.
const cameraLocationsXmlFixture = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ns17:payload xsi:type="ns4:PredefinedLocationsPublication" lang="en" modelBaseVersion="3" xmlns="http://datex2.eu/schema/3/trafficRegulation" xmlns:ns2="http://datex2.eu/schema/3/common" xmlns:ns4="http://datex2.eu/schema/3/locationReferencing" xmlns:ns6="http://datex2.eu/schema/3/commonExtension" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <ns2:feedType>Traffic camera locations</ns2:feedType>
    <ns4:predefinedLocationReference xsi:type="ns4:PredefinedLocation" id="0424e1a7-3105-4e64-a47b-4f4740ec795a" version="0">
        <ns4:predefinedLocationName>
            <ns2:values>
                <ns2:value lang="et">Lokuti</ns2:value>
            </ns2:values>
        </ns4:predefinedLocationName>
        <ns4:location xsi:type="ns4:PointLocation">
            <ns4:pointByCoordinates>
                <ns4:pointCoordinates>
                    <ns4:latitude>59.280315</ns4:latitude>
                    <ns4:longitude>24.741144</ns4:longitude>
                </ns4:pointCoordinates>
            </ns4:pointByCoordinates>
        </ns4:location>
        <ns4:_predefinedLocationExtension>
            <ns6:roadCameraLocationExtension>
                <ns6:urlLink>
                    <ns2:urlLinkAddress>https://tarktee.transpordiamet.ee/images/165/165_202607061412.jpg</ns2:urlLinkAddress>
                    <ns2:urlLinkType>image</ns2:urlLinkType>
                </ns6:urlLink>
            </ns6:roadCameraLocationExtension>
        </ns4:_predefinedLocationExtension>
    </ns4:predefinedLocationReference>
    <ns4:predefinedLocationReference xsi:type="ns4:PredefinedLocation" id="eab31605-3476-40a1-a398-df064446dffa" version="0">
        <ns4:predefinedLocationName>
            <ns2:values>
                <ns2:value lang="et">Nõva</ns2:value>
            </ns2:values>
        </ns4:predefinedLocationName>
        <ns4:location xsi:type="ns4:PointLocation">
            <ns4:pointByCoordinates>
                <ns4:pointCoordinates>
                    <ns4:latitude>59.18556</ns4:latitude>
                    <ns4:longitude>23.64891</ns4:longitude>
                </ns4:pointCoordinates>
            </ns4:pointByCoordinates>
        </ns4:location>
        <ns4:_predefinedLocationExtension>
            <ns6:roadCameraLocationExtension>
                <ns6:urlLink>
                    <ns2:urlLinkAddress>https://tarktee.transpordiamet.ee/images/88/88_202607061412.jpg</ns2:urlLinkAddress>
                    <ns2:urlLinkType>image</ns2:urlLinkType>
                </ns6:urlLink>
            </ns6:roadCameraLocationExtension>
        </ns4:_predefinedLocationExtension>
    </ns4:predefinedLocationReference>
</ns17:payload>`;

function mockFetchOnceJson(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  });
}

function mockFetchOnceText(body: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => body,
  });
}

describe("tarktee.ts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always sends Accept-Encoding: identity (regression test for the Phase 0 chunked-encoding fix)", async () => {
    const fetchMock = mockFetchOnceText(cameraLocationsXmlFixture);
    vi.stubGlobal("fetch", fetchMock);

    await fetchCamerasMetadata();

    const [, options] = fetchMock.mock.calls[0];
    expect((options.headers as Record<string, string>)["Accept-Encoding"]).toBe("identity");
  });

  // Regression test: cameras used to come from a JSON "metadata" endpoint whose geometry
  // field turned out to be null for every single entry in production (a real bug, not a
  // hypothetical) — replaced with the DATEX II v3.6 roadCameraLocations XML feed instead,
  // which also carries the live image URL used for the paid-tier camera image feature.
  it("parses camera locations and image URLs from the DATEX II v3.6 XML feed", async () => {
    const fetchMock = mockFetchOnceText(cameraLocationsXmlFixture);
    vi.stubGlobal("fetch", fetchMock);

    const cameras = await fetchCamerasMetadata();

    expect(cameras).toEqual([
      {
        id: "0424e1a7-3105-4e64-a47b-4f4740ec795a",
        name: "Lokuti",
        lat: 59.280315,
        lng: 24.741144,
        imageUrl: "https://tarktee.transpordiamet.ee/images/165/165_202607061412.jpg",
      },
      {
        id: "eab31605-3476-40a1-a398-df064446dffa",
        name: "Nõva",
        lat: 59.18556,
        lng: 23.64891,
        imageUrl: "https://tarktee.transpordiamet.ee/images/88/88_202607061412.jpg",
      },
    ]);
  });

  // Regression test: the header name was initially guessed as "X-API-Key" before reading
  // Tark Tee's own DATEX II profile doc, which specifies "X-DATEX-API-KEY".
  it("sends the API key in the X-DATEX-API-KEY header, not X-API-Key", async () => {
    const fetchMock = mockFetchOnceJson({ situation: [], lang: "et" });
    vi.stubGlobal("fetch", fetchMock);

    await fetchHazards("test-key-123", "slippery");

    const [, options] = fetchMock.mock.calls[0];
    const headers = options.headers as Record<string, string>;
    expect(headers["X-DATEX-API-KEY"]).toBe("test-key-123");
    expect(headers["X-API-Key"]).toBeUndefined();
  });

  it("returns an empty result without fetching when no API key is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchHazards(undefined, "slippery");

    expect(result).toEqual({ records: [], situationCount: 0, skipped: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Regression test for a real production incident: every hazard record was silently
  // discarded because this parser looked for coordinates at groupOfLocations.locationForDisplay
  // (a guess from the general DATEX II 3.6 SRTI standard) while Tark Tee's real payloads put
  // them at locationReference.pointByCoordinates.pointCoordinates instead — confirmed against
  // an actual production "shortTermRoadWorks" record (trimmed here to the relevant fields).
  it("parses a real hazard record's location from locationReference.pointByCoordinates.pointCoordinates", async () => {
    const fetchMock = mockFetchOnceJson({
      situation: [
        {
          situationRecord: [
            {
              id: "11c44ffe-7474-4578-a8ff-39b9765387c9",
              validity: { validityTimeSpecification: { overallStartTime: "2026-07-26T05:00:00.000Z" } },
              locationReference: {
                pointByCoordinates: { pointCoordinates: { latitude: 59.33447, longitude: 24.807602 } },
              },
              generalPublicComment: [],
            },
          ],
        },
      ],
      lang: "et",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchHazards("test-key-123", "roadworks");

    expect(result.skipped).toEqual([]);
    expect(result.records).toEqual([
      expect.objectContaining({
        externalId: "11c44ffe-7474-4578-a8ff-39b9765387c9",
        eventType: "roadworks",
        lat: 59.33447,
        lng: 24.807602,
      }),
    ]);
  });

  // Regression test: externalId is a NOT NULL D1 primary key — a record with neither its own
  // id nor a fallback situation id must be skipped, not passed through as `undefined` (which
  // would fail the whole batch write for every hazard type fetched that cycle, not just this
  // record — see db.ts's upsertHazardsAndGetChanged).
  it("skips a situation record with no usable id instead of producing an undefined externalId", async () => {
    const fetchMock = mockFetchOnceJson({
      situation: [
        {
          // situation.id itself missing too, not just situationRecord[].id
          situationRecord: [
            {
              locationReference: {
                pointByCoordinates: { pointCoordinates: { latitude: 59.4, longitude: 24.7 } },
              },
            },
          ],
        },
      ],
      lang: "et",
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchHazards("test-key-123", "slippery");

    expect(result.records).toEqual([]);
    expect(result.skipped).toEqual([{ reason: "no-id", raw: expect.any(String) }]);
  });

  // Regression test for a real production incident: Tark Tee's animalObstacle SRTI endpoint
  // returning a 502 was silently discarding every other hazard type's real data too, via
  // Promise.all's all-or-nothing rejection — the hazards table stayed empty for as long as
  // that one endpoint was down, despite the other 6 feeds working fine.
  it("keeps hazards from feeds that succeeded even when one feed's request fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("animalObstacle")) {
        return Promise.resolve({ ok: false, status: 502, statusText: "Bad Gateway" });
      }
      if (url.includes("temporarySlipperyRoad")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            situation: [
              {
                id: "situation-1",
                situationRecord: [
                  {
                    locationReference: {
                      pointByCoordinates: { pointCoordinates: { latitude: 59.4, longitude: 24.7 } },
                    },
                  },
                ],
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, statusText: "OK", json: async () => ({ situation: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { records, perFeed } = await fetchAllHazards("test-key-123");

    expect(records).toEqual([expect.objectContaining({ externalId: "situation-1", eventType: "slippery" })]);
    expect(perFeed.obstacle.error).toContain("502");
    expect(perFeed.slippery).toEqual({ situations: 1, usable: 1 });
    // One combined log line for the whole poll cycle, not one per feed — see fetchAllHazards's
    // own comment on why (Workers Logs counts/bills per event).
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("logs an error when 0 cameras are parsed from a non-trivial response (likely a schema change, not genuinely zero cameras)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = mockFetchOnceText(`<payload>${"x".repeat(600)}</payload>`);
    vi.stubGlobal("fetch", fetchMock);

    const cameras = await fetchCamerasMetadata();

    expect(cameras).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("schema may have changed"));
    errorSpy.mockRestore();
  });
});
