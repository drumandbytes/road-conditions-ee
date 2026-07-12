import { afterEach, describe, expect, it, vi } from "vitest";
import weatherStationsFixture from "./mocks/arcgis-weather-stations.json";
import restrictionsFixture from "./mocks/arcgis-restrictions.json";
import vmsSignsFixture from "./mocks/arcgis-vms-signs.json";
import { fetchRestrictions, fetchVmsSigns, fetchWeatherReadings } from "../src/arcgis";

function mockFetchOnceJson(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  });
}

describe("arcgis.ts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Transform accuracy verified separately against a known real coordinate pair (Aranküla,
  // cross-checked against its WGS84 location in the existing DATEX-sourced dataset — see
  // arcgis.ts's EPSG_3301 comment). This just checks the parse+transform wiring end to end.
  it("parses weather readings and transforms EPSG:3301 coordinates to WGS84", async () => {
    const fetchMock = mockFetchOnceJson(weatherStationsFixture);
    vi.stubGlobal("fetch", fetchMock);

    const readings = await fetchWeatherReadings();

    expect(readings).toHaveLength(1); // the null-geometry entry (Luhamaa) is filtered out
    const [aranküla] = readings;
    expect(aranküla.id).toBe(47);
    expect(aranküla.name).toBe("Aranküla");
    expect(aranküla.lng).toBeCloseTo(24.8353, 3);
    expect(aranküla.lat).toBeCloseTo(59.0389, 3);
    expect(aranküla.roadStatus).toBe("MOIST");
    expect(aranküla.roadStatusAggregate).toBe("COLD_WET_SURFACE");
    expect(aranküla.roadTemp).toBe(21.7);
    expect(aranküla.gripFactor).toBe(0.37);
    expect(aranküla.measurementTime).toBe(new Date(1783796400000).toISOString());
  });

  it("skips features with null geometry rather than failing the whole fetch", async () => {
    const fetchMock = mockFetchOnceJson(weatherStationsFixture);
    vi.stubGlobal("fetch", fetchMock);

    const readings = await fetchWeatherReadings();

    expect(readings.find((r) => r.name === "Luhamaa")).toBeUndefined();
  });

  it("parses restrictions and transforms coordinates", async () => {
    const fetchMock = mockFetchOnceJson(restrictionsFixture);
    vi.stubGlobal("fetch", fetchMock);

    const restrictions = await fetchRestrictions();

    expect(restrictions).toHaveLength(1);
    const [r] = restrictions;
    expect(r.id).toBe(1607);
    expect(r.roadName).toBe("Kõmsi - Mõisaküla - Salevere");
    expect(r.cause).toBe("PAVING");
    expect(r.effect).toBe("SPEED_LIMITED");
    expect(r.lat).toBeGreaterThan(0);
    expect(r.lng).toBeGreaterThan(0);
    expect(r.dateFrom).toBe(new Date(1504472400000).toISOString());
  });

  it("sends the active-window where clause as a query param", async () => {
    const fetchMock = mockFetchOnceJson(restrictionsFixture);
    vi.stubGlobal("fetch", fetchMock);

    await fetchRestrictions();

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("where=");
    expect(String(url)).toContain("date_to");
  });

  it("stops after one request when the page isn't full (no exceededTransferLimit)", async () => {
    const fetchMock = mockFetchOnceJson(restrictionsFixture); // exceededTransferLimit: false, 1 feature
    vi.stubGlobal("fetch", fetchMock);

    await fetchRestrictions();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Esri only sets exceededTransferLimit=true when a page came back exactly at the page-size
  // cap — a full page like that must trigger a second request at the next offset.
  it("fetches a second page when the first is full and exceededTransferLimit is true", async () => {
    const fullFeature = restrictionsFixture.features[0];
    const fullPage = { exceededTransferLimit: true, features: Array(1000).fill(fullFeature) };
    const shortPage = { exceededTransferLimit: false, features: [fullFeature] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => fullPage })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => shortPage });
    vi.stubGlobal("fetch", fetchMock);

    const restrictions = await fetchRestrictions();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(restrictions).toHaveLength(1001);
    expect(String(fetchMock.mock.calls[1][0])).toContain("resultOffset=1000");
  });

  // VMS signs use a different pagination scheme than restrictions/detours — confirmed
  // directly against the real service that it silently caps at 100 regardless of a larger
  // resultRecordCount request, and ignores exceededTransferLimit in a way that makes the
  // restrictions-style "trust exceededTransferLimit" loop unsafe here. Page size 50, stop
  // when a page comes back short — verified this combination actually retrieves the full
  // real dataset (150 of the 180 the service claims via count; the other 30 aren't
  // retrievable by query at all, a discrepancy confirmed directly, not assumed).
  it("parses VMS signs and transforms coordinates", async () => {
    const fetchMock = mockFetchOnceJson(vmsSignsFixture);
    vi.stubGlobal("fetch", fetchMock);

    const signs = await fetchVmsSigns();

    expect(signs).toHaveLength(1);
    const [s] = signs;
    expect(s.id).toBe(1001010521);
    expect(s.roadName).toBe("Tallinna-Narva tee");
    expect(s.speedLimit).toBe(70);
    expect(s.warning).toBeNull();
    expect(s.lat).toBeGreaterThan(0);
    expect(s.lng).toBeGreaterThan(0);
    expect(s.speedLimitChangedAt).toBe(new Date(1783690694000).toISOString());
  });

  it("stops paginating VMS signs once a page is shorter than the page size", async () => {
    const fetchMock = mockFetchOnceJson(vmsSignsFixture); // 1 feature, well under the 50-per-page size
    vi.stubGlobal("fetch", fetchMock);

    await fetchVmsSigns();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requests a second VMS page when the first comes back exactly full", async () => {
    const fullFeature = vmsSignsFixture.features[0];
    const fullPage = { features: Array(50).fill(fullFeature) };
    const shortPage = { features: [fullFeature] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => fullPage })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => shortPage });
    vi.stubGlobal("fetch", fetchMock);

    const signs = await fetchVmsSigns();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signs).toHaveLength(51);
    expect(String(fetchMock.mock.calls[1][0])).toContain("resultOffset=50");
    expect(String(fetchMock.mock.calls[0][0])).toContain("orderByFields=objectid");
  });
});
