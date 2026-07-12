import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCamerasMetadata, fetchHazards } from "../src/tarktee";

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

  it("returns an empty array without fetching when no API key is set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const hazards = await fetchHazards(undefined, "slippery");

    expect(hazards).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
