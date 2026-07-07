import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWeatherStations } from "../src/routes/weather";
import { handleCameraImage, handleCameras } from "../src/routes/cameras";
import { handleHazards } from "../src/routes/hazards";
import { corsHeaders, handlePreflight, isAllowedOrigin } from "../src/cors";
import { authenticatePaidUser } from "../src/auth";
import type { UserRow } from "../src/db";

/** Minimal D1Database fake — enough of the prepare/bind/all/first chain for these routes,
 *  matching the existing repo's pattern of hand-mocking bindings rather than pulling in
 *  @cloudflare/vitest-pool-workers. */
function fakeDb(rows: unknown[]): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: rows }),
        first: async () => rows[0] ?? null,
      }),
      all: async () => ({ results: rows }),
      first: async () => rows[0] ?? null,
    }),
  } as unknown as D1Database;
}

describe("handleWeatherStations", () => {
  it("builds a GeoJSON FeatureCollection from station rows", async () => {
    const db = fakeDb([{ id: 1, name: "Uku", lat: 59.39, lng: 26.01, status: "green", last_updated_at: "t" }]);
    const res = await handleWeatherStations(db);
    const body = await res.json();
    expect(body).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: 1, name: "Uku", status: "green", lastUpdatedAt: "t" },
          geometry: { type: "Point", coordinates: [26.01, 59.39] },
        },
      ],
    });
  });
});

describe("handleCameras", () => {
  it("builds a GeoJSON FeatureCollection from camera rows", async () => {
    const db = fakeDb([{ id: "0424e1a7-3105-4e64-a47b-4f4740ec795a", name: "Lokuti", lat: 58.5, lng: 25.9, image_url: "https://tarktee.transpordiamet.ee/images/1/1.jpg" }]);
    const res = await handleCameras(db);
    const body = (await res.json()) as { features: Array<{ properties: Record<string, unknown>; geometry: { coordinates: number[] } }> };
    expect(body.features).toHaveLength(1);
    expect(body.features[0].geometry.coordinates).toEqual([25.9, 58.5]);
    // image_url is paid-tier only — must never leak into the free response.
    expect(body.features[0].properties.image_url).toBeUndefined();
    expect(body.features[0].properties.imageUrl).toBeUndefined();
  });
});

describe("handleCameraImage", () => {
  const activeUser: UserRow = {
    id: "u1",
    email: null,
    stripe_customer_id: null,
    subscription_status: "active",
    bearer_token: "tok",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 402 when there is no authenticated paid user", async () => {
    const db = fakeDb([]);
    const res = await handleCameraImage("cam-1", null, db);
    expect(res.status).toBe(402);
  });

  it("returns 404 when the camera doesn't exist", async () => {
    const db = fakeDb([]);
    const res = await handleCameraImage("missing-id", activeUser, db);
    expect(res.status).toBe(404);
  });

  it("returns 404 when the camera has no image_url", async () => {
    const db = fakeDb([{ id: "cam-1", name: "Lokuti", lat: 58.5, lng: 25.9, image_url: null }]);
    const res = await handleCameraImage("cam-1", activeUser, db);
    expect(res.status).toBe(404);
  });

  it("proxies the upstream image on a cache miss and never redirects to Tark Tee directly", async () => {
    const db = fakeDb([
      { id: "cam-1", name: "Lokuti", lat: 58.5, lng: 25.9, image_url: "https://tarktee.transpordiamet.ee/images/1/1.jpg" },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(["fake-jpeg-bytes"]), { status: 200, headers: { "Content-Type": "image/jpeg" } }),
    );
    const cachePut = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("caches", { default: { match: vi.fn().mockResolvedValue(undefined), put: cachePut } });

    const res = await handleCameraImage("cam-1", activeUser, db);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Location")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("https://tarktee.transpordiamet.ee/images/1/1.jpg");
    expect(cachePut).toHaveBeenCalled();
  });
});

describe("handleHazards", () => {
  it("builds a GeoJSON FeatureCollection from hazard rows", async () => {
    const db = fakeDb([
      { external_id: "abc", event_type: "slippery", lat: 59.1, lng: 24.9, description: "icy", starts_at: null, ends_at: null, updated_at: "t" },
    ]);
    const res = await handleHazards(db);
    const body = (await res.json()) as { features: Array<{ properties: { eventType: string } }> };
    expect(body.features[0].properties.eventType).toBe("slippery");
  });
});

describe("CORS", () => {
  it("responds to OPTIONS preflight with the request's own (allowed) origin", () => {
    const req = new Request("https://example.com/api/hazards", {
      method: "OPTIONS",
      headers: { Origin: "https://road-conditions-ee.pages.dev" },
    });
    const res = handlePreflight(req);
    expect(res?.status).toBe(204);
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("https://road-conditions-ee.pages.dev");
  });

  it("rejects OPTIONS preflight from a disallowed origin", () => {
    const req = new Request("https://example.com/api/hazards", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example.com" },
    });
    expect(handlePreflight(req)?.status).toBe(403);
  });

  it("returns null for non-OPTIONS requests", () => {
    const req = new Request("https://example.com/api/hazards", { method: "GET" });
    expect(handlePreflight(req)).toBeNull();
  });

  it("allows any road-conditions-ee.pages.dev preview subdomain", () => {
    expect(isAllowedOrigin("https://a8001fbf.road-conditions-ee.pages.dev")).toBe(true);
    expect(isAllowedOrigin("https://road-conditions-ee.pages.dev")).toBe(true);
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
  });

  it("never uses a wildcard origin", () => {
    const headers = corsHeaders("https://road-conditions-ee.pages.dev");
    expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
  });
});

describe("authenticatePaidUser", () => {
  it("returns null when there is no Authorization header", async () => {
    const db = fakeDb([]);
    const req = new Request("https://example.com/api/vms");
    expect(await authenticatePaidUser(db, req)).toBeNull();
  });

  it("returns null when the token doesn't match a user", async () => {
    const db = fakeDb([]);
    const req = new Request("https://example.com/api/vms", { headers: { Authorization: "Bearer nope" } });
    expect(await authenticatePaidUser(db, req)).toBeNull();
  });

  it("returns null when the user's subscription isn't active", async () => {
    const db = fakeDb([{ id: "u1", subscription_status: "free", bearer_token: "tok" }]);
    const req = new Request("https://example.com/api/vms", { headers: { Authorization: "Bearer tok" } });
    expect(await authenticatePaidUser(db, req)).toBeNull();
  });

  it("returns the user when the token matches and subscription is active", async () => {
    const db = fakeDb([{ id: "u1", subscription_status: "active", bearer_token: "tok" }]);
    const req = new Request("https://example.com/api/vms", { headers: { Authorization: "Bearer tok" } });
    const user = await authenticatePaidUser(db, req);
    expect(user?.id).toBe("u1");
  });
});
