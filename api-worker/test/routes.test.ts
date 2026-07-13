import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWeatherStations } from "../src/routes/weather";
import { handleCameraImage, handleCameras } from "../src/routes/cameras";
import { handleGeocode } from "../src/routes/geocode";
import { handleHazards } from "../src/routes/hazards";
import { handlePushSubscription } from "../src/routes/push-subscription";
import { handleRequestLogin, handleVerifyLogin } from "../src/routes/login";
import { handleRestrictions } from "../src/routes/restrictions";
import { handleVms } from "../src/routes/vms";
import { handleWeatherStationHistory } from "../src/routes/weather-history";
import { handleListSavedPoints, handleSubscribe, handleUnsubscribe } from "../src/routes/subscribe";
import { handleCheckout, handleCheckoutSession, handlePortal } from "../src/routes/checkout";
import { handleStripeWebhook } from "../src/routes/stripe-webhook";
import { corsHeaders, handlePreflight, isAllowedOrigin } from "../src/cors";
import { authenticatePaidUser } from "../src/auth";
import { updateSubscriptionStatusByStripeCustomerId, upsertUserFromStripe } from "../src/db";
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
  it("builds a GeoJSON FeatureCollection with real readings from station rows", async () => {
    const db = fakeDb([
      {
        id: 1, name: "Uku", lat: 59.39, lng: 26.01,
        road_status: "DRY", road_status_aggregate: "OK", road_temp: 21.7, air_temp: 17.6,
        precipitation_type: "NO_PRECIPITATION", precipitation_intensity: 0, wind_dir: 347, wind_speed: 0.6,
        air_humidity: 95, visibility: 2000, grip_factor: 0.9, measurement_time: "m", last_updated_at: "t",
      },
    ]);
    const res = await handleWeatherStations(db);
    const body = await res.json();
    expect(body).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            id: 1, name: "Uku", roadStatus: "DRY", roadStatusAggregate: "OK", roadTemp: 21.7, airTemp: 17.6,
            precipitationType: "NO_PRECIPITATION", precipitationIntensity: 0, windDir: 347, windSpeed: 0.6,
            airHumidity: 95, visibility: 2000, gripFactor: 0.9, measurementTime: "m", lastUpdatedAt: "t",
          },
          geometry: { type: "Point", coordinates: [26.01, 59.39] },
        },
      ],
    });
  });
});

describe("handleRestrictions", () => {
  it("builds a GeoJSON FeatureCollection from restriction rows", async () => {
    const db = fakeDb([
      {
        id: 1607, road_nr: 16187, road_name: "Kõmsi - Mõisaküla - Salevere", road_type: "SECONDARY_ROAD",
        cause: "PAVING", effect: "SPEED_LIMITED", extra_info: "Kiirus piiratud 30 km/h.", extra_info_en: "Speed limited to 30 km/h.",
        detour_comment: null,
        contractor_organization: "AS TREV-2 Grupp", contractor_contact_phone: "53 359 067",
        traffic_ctrl_organization: null, traffic_ctrl_contact_phone: "53 407 504",
        date_from: "2017-09-03T21:00:00.000Z", date_to: null, lat: 58.6, lng: 24.5,
        detour_description: "Ümbersõit on korraldatud Kose mnt kaudu.",
      },
    ]);
    const res = await handleRestrictions(db);
    const body = (await res.json()) as { features: Array<{ properties: { roadName: string; cause: string; detourDescription: string; extraInfoEn: string } }> };
    expect(body.features[0].properties.roadName).toBe("Kõmsi - Mõisaküla - Salevere");
    expect(body.features[0].properties.cause).toBe("PAVING");
    expect(body.features[0].properties.extraInfoEn).toBe("Speed limited to 30 km/h.");
    expect(body.features[0].properties.detourDescription).toBe("Ümbersõit on korraldatud Kose mnt kaudu.");
  });
});

describe("handleVms", () => {
  const signRow = {
    sign_id: 1001010521, road_nr: 1, road_name: "Tallinna-Narva tee", road_km: 10.5, angle: 248,
    speed_limit: 70, speed_limit_changed_at: "2026-07-10T13:38:14.000Z",
    warning: null, warning_changed_at: null, lat: 59.445, lng: 24.918,
  };
  const vmsUser: UserRow = {
    id: "u1", email: "a@b.com", stripe_customer_id: "cus_1", subscription_status: "active", bearer_token: "tok",
  };

  it("returns location + road context only for a free/unauthenticated caller, no live content", async () => {
    const res = await handleVms(fakeDb([signRow]), null);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: Array<{ properties: Record<string, unknown> }> };
    expect(body.features[0].properties).toEqual({
      id: 1001010521,
      roadName: "Tallinna-Narva tee",
      roadKm: 10.5,
      paid: false,
    });
  });

  it("returns full live content for an authenticated paid caller", async () => {
    const res = await handleVms(fakeDb([signRow]), vmsUser);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: Array<{ properties: Record<string, unknown> }> };
    expect(body.features[0].properties).toEqual({
      id: 1001010521,
      roadNr: 1,
      roadName: "Tallinna-Narva tee",
      roadKm: 10.5,
      angle: 248,
      speedLimit: 70,
      speedLimitChangedAt: "2026-07-10T13:38:14.000Z",
      warning: null,
      warningChangedAt: null,
      paid: true,
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

describe("handleWeatherStationHistory", () => {
  const activeUser: UserRow = {
    id: "u1",
    email: null,
    stripe_customer_id: null,
    subscription_status: "active",
    bearer_token: "tok",
  };

  it("returns 402 when there is no authenticated paid user", async () => {
    const db = fakeDb([]);
    const res = await handleWeatherStationHistory("Aranküla", null, db);
    expect(res.status).toBe(402);
  });

  it("returns hourly readings for the given station name when authenticated", async () => {
    const db = fakeDb([
      {
        recorded_at: "2026-07-12T08:00:00.000Z", road_status: "DRY", road_status_aggregate: "OK",
        road_temp: 21.7, air_temp: 17.6, precipitation_type: null, precipitation_intensity: null,
        wind_dir: 347, wind_speed: 0.6, air_humidity: 95, visibility: 2000, grip_factor: 0.9,
      },
    ]);
    const res = await handleWeatherStationHistory("Aranküla", activeUser, db);
    const body = (await res.json()) as { stationName: string; readings: Array<{ roadTemp: number }> };
    expect(body.stationName).toBe("Aranküla");
    expect(body.readings).toHaveLength(1);
    expect(body.readings[0].roadTemp).toBe(21.7);
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

  it("allows the roadconditions.drumandbytes.ee custom domain", () => {
    expect(isAllowedOrigin("https://roadconditions.drumandbytes.ee")).toBe(true);
    expect(isAllowedOrigin("https://evil.drumandbytes.ee")).toBe(false);
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

  it("also grants access to a lifetime user (never expires, no recurring subscription)", async () => {
    const db = fakeDb([{ id: "u1", subscription_status: "lifetime", bearer_token: "tok" }]);
    const req = new Request("https://example.com/api/vms", { headers: { Authorization: "Bearer tok" } });
    const user = await authenticatePaidUser(db, req);
    expect(user?.id).toBe("u1");
  });
});

/** Like fakeDb, but also records the bound args of the last prepared statement — needed to
 *  assert what the Stripe upsert/update helpers actually send to D1. */
function fakeDbCapturing(returningRow: unknown) {
  const calls: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...args: unknown[]) => {
        calls.push(args);
        return { first: async () => returningRow, run: async () => ({ success: true }) };
      },
    }),
  } as unknown as D1Database;
  return { db, calls };
}

function mockFetchJson(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("upsertUserFromStripe", () => {
  it("binds a freshly-generated id/bearer_token alongside the given Stripe fields", async () => {
    const returningRow: UserRow = {
      id: "generated-id",
      email: "a@b.com",
      stripe_customer_id: "cus_1",
      subscription_status: "active",
      bearer_token: "generated-token",
    };
    const { db, calls } = fakeDbCapturing(returningRow);

    const user = await upsertUserFromStripe(db, {
      stripeCustomerId: "cus_1",
      email: "a@b.com",
      subscriptionStatus: "active",
    });

    expect(user).toEqual(returningRow);
    const [id, email, stripeCustomerId, subscriptionStatus, bearerToken] = calls[0];
    expect(email).toBe("a@b.com");
    expect(stripeCustomerId).toBe("cus_1");
    expect(subscriptionStatus).toBe("active");
    expect(typeof id).toBe("string");
    expect(typeof bearerToken).toBe("string");
    // Real randomness, not placeholders — a returning customer must not get a predictable token.
    expect((id as string).length).toBeGreaterThan(0);
    expect((bearerToken as string).length).toBeGreaterThan(0);
  });
});

describe("updateSubscriptionStatusByStripeCustomerId", () => {
  it("binds the new status and the customer id to filter by", async () => {
    const { db, calls } = fakeDbCapturing(null);
    await updateSubscriptionStatusByStripeCustomerId(db, "cus_1", "canceled");
    expect(calls[0]).toEqual(["canceled", "cus_1"]);
  });
});

function checkoutRequest(body: unknown) {
  return new Request("https://example.com/api/checkout", { method: "POST", body: JSON.stringify(body) });
}

describe("handleCheckout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 503 when Stripe isn't configured", async () => {
    const res = await handleCheckout(checkoutRequest({ plan: "monthly" }), {});
    expect(res.status).toBe(503);
  });

  it("returns 400 for a missing or invalid plan", async () => {
    const res = await handleCheckout(checkoutRequest({}), { STRIPE_SECRET_KEY: "sk_test_x" });
    expect(res.status).toBe(400);
    const res2 = await handleCheckout(checkoutRequest({ plan: "weekly" }), { STRIPE_SECRET_KEY: "sk_test_x" });
    expect(res2.status).toBe(400);
  });

  it("returns the Stripe-hosted checkout URL for a monthly plan with a trial", async () => {
    const fetchMock = mockFetchJson(200, { id: "cs_test_1", url: "https://checkout.stripe.com/pay/cs_test_1" });
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleCheckout(checkoutRequest({ plan: "monthly" }), { STRIPE_SECRET_KEY: "sk_test_x" });
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe("https://checkout.stripe.com/pay/cs_test_1");

    const [, options] = fetchMock.mock.calls[0];
    const sentBody = String(options.body);
    expect(sentBody).toContain("mode=subscription");
    expect(sentBody).toContain("subscription_data[trial_period_days]=30");
    expect(sentBody).toContain("allow_promotion_codes=true");
  });

  it("returns 400 for the (deliberately unsupported) lifetime plan — comps are manual, not sold", async () => {
    const res = await handleCheckout(checkoutRequest({ plan: "lifetime" }), { STRIPE_SECRET_KEY: "sk_test_x" });
    expect(res.status).toBe(400);
  });
});

describe("handleCheckoutSession", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 503 when Stripe isn't configured", async () => {
    const res = await handleCheckoutSession("cs_1", { DB: fakeDb([]) });
    expect(res.status).toBe(503);
  });

  it("returns 402 when the session hasn't actually been paid", async () => {
    vi.stubGlobal("fetch", mockFetchJson(200, { id: "cs_1", customer: "cus_1", payment_status: "unpaid" }));
    const res = await handleCheckoutSession("cs_1", { STRIPE_SECRET_KEY: "sk_test_x", DB: fakeDb([]) });
    expect(res.status).toBe(402);
  });

  it("upserts the user and returns their bearer token on a paid session", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson(200, {
        id: "cs_1",
        customer: "cus_1",
        payment_status: "paid",
        customer_details: { email: "a@b.com" },
      }),
    );
    const { db } = fakeDbCapturing({
      id: "u1",
      email: "a@b.com",
      stripe_customer_id: "cus_1",
      subscription_status: "active",
      bearer_token: "tok123",
    });
    const res = await handleCheckoutSession("cs_1", { STRIPE_SECRET_KEY: "sk_test_x", DB: db });
    const body = (await res.json()) as { bearerToken: string };
    expect(body.bearerToken).toBe("tok123");
  });

});

describe("handlePortal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const activeUser: UserRow = {
    id: "u1",
    email: "a@b.com",
    stripe_customer_id: "cus_1",
    subscription_status: "active",
    bearer_token: "tok",
  };

  it("returns 402 when there is no authenticated user", async () => {
    const res = await handlePortal(null, {});
    expect(res.status).toBe(402);
  });

  it("returns 503 when Stripe isn't configured", async () => {
    const res = await handlePortal(activeUser, {});
    expect(res.status).toBe(503);
  });

  it("returns 404 when the user has no Stripe customer id on file", async () => {
    const res = await handlePortal({ ...activeUser, stripe_customer_id: null }, { STRIPE_SECRET_KEY: "sk_test_x" });
    expect(res.status).toBe(404);
  });

  it("returns the Stripe billing portal URL on success", async () => {
    vi.stubGlobal("fetch", mockFetchJson(200, { url: "https://billing.stripe.com/session/x" }));
    const res = await handlePortal(activeUser, { STRIPE_SECRET_KEY: "sk_test_x" });
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe("https://billing.stripe.com/session/x");
  });
});

describe("handleStripeWebhook", () => {
  it("returns 503 when Stripe isn't configured", async () => {
    const req = new Request("https://example.com/api/stripe-webhook", { method: "POST", body: "{}" });
    const res = await handleStripeWebhook(req, { DB: fakeDb([]) });
    expect(res.status).toBe(503);
  });

  it("returns 400 when the Stripe-Signature header is missing", async () => {
    const req = new Request("https://example.com/api/stripe-webhook", { method: "POST", body: "{}" });
    const res = await handleStripeWebhook(req, {
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      DB: fakeDb([]),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the signature doesn't verify", async () => {
    const req = new Request("https://example.com/api/stripe-webhook", {
      method: "POST",
      body: "{}",
      headers: { "Stripe-Signature": "t=1,v1=bogus" },
    });
    const res = await handleStripeWebhook(req, {
      STRIPE_SECRET_KEY: "sk_test_x",
      STRIPE_WEBHOOK_SECRET: "whsec_x",
      DB: fakeDb([]),
    });
    expect(res.status).toBe(400);
  });
});

describe("handleGeocode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a too-short query without calling Nominatim", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleGeocode(new Request("https://example.com/api/geocode?q=ab"));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies to Nominatim, scoped to Estonia, and maps to label/lat/lng", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([{ display_name: "Narva mnt 5, Tallinn, Eesti", lat: "59.437", lon: "24.758" }]),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleGeocode(new Request("https://example.com/api/geocode?q=Narva+mnt+5"));
    const body = await res.json();

    expect(body).toEqual([{ label: "Narva mnt 5, Tallinn, Eesti", lat: 59.437, lng: 24.758 }]);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("countrycodes=ee");
  });

  it("returns 502 when Nominatim itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    const res = await handleGeocode(new Request("https://example.com/api/geocode?q=Narva+mnt"));
    expect(res.status).toBe(502);
  });
});

const PAID_USER: UserRow = {
  id: "u1",
  email: "a@b.com",
  stripe_customer_id: "cus_1",
  subscription_status: "active",
  bearer_token: "tok",
};

describe("handleListSavedPoints", () => {
  it("requires a paid user", async () => {
    const res = await handleListSavedPoints(fakeDb([]), null);
    expect(res.status).toBe(402);
  });

  it("returns saved points with camelCase fields and parsed eventTypes", async () => {
    const db = fakeDb([
      { id: 1, user_id: "u1", label: "Home", lat: 59.4, lng: 24.7, radius_km: 5, event_types: '["slippery","accident"]' },
      { id: 2, user_id: "u1", label: "Work", lat: 58.4, lng: 26.7, radius_km: 10, event_types: null },
    ]);
    const res = await handleListSavedPoints(db, PAID_USER);
    const body = await res.json();
    expect(body).toEqual([
      { id: 1, label: "Home", lat: 59.4, lng: 24.7, radiusKm: 5, eventTypes: ["slippery", "accident"] },
      { id: 2, label: "Work", lat: 58.4, lng: 26.7, radiusKm: 10, eventTypes: null },
    ]);
  });
});

describe("handleSubscribe", () => {
  function subscribeRequest(body: unknown): Request {
    return new Request("https://example.com/api/subscribe", { method: "POST", body: JSON.stringify(body) });
  }

  it("requires a paid user", async () => {
    const res = await handleSubscribe(subscribeRequest({}), fakeDb([]), null);
    expect(res.status).toBe(402);
  });

  it("rejects a coordinate well outside Estonia", async () => {
    const res = await handleSubscribe(
      subscribeRequest({ label: "Home", lat: 40.7, lng: -74, radiusKm: 5, eventTypes: null }),
      fakeDb([]),
      PAID_USER,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an empty label", async () => {
    const res = await handleSubscribe(
      subscribeRequest({ label: "  ", lat: 59.4, lng: 24.7, radiusKm: 5, eventTypes: null }),
      fakeDb([]),
      PAID_USER,
    );
    expect(res.status).toBe(400);
  });

  it("creates a saved point and returns it with the caller's user id bound, not a client-supplied one", async () => {
    const returningRow = { id: 1, user_id: "u1", label: "Home", lat: 59.4, lng: 24.7, radius_km: 5, event_types: '["slippery"]' };
    const { db, calls } = fakeDbCapturing(returningRow);

    const res = await handleSubscribe(
      subscribeRequest({ label: "Home", lat: 59.4, lng: 24.7, radiusKm: 5, eventTypes: ["slippery"], userId: "someone-else" }),
      db,
      PAID_USER,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: 1, label: "Home", lat: 59.4, lng: 24.7, radiusKm: 5, eventTypes: ["slippery"] });
    // First bound param is user_id — must be the authenticated user's id, ignoring any
    // userId the client tried to slip into the body.
    expect(calls[0][0]).toBe("u1");
  });
});

describe("handleUnsubscribe", () => {
  function fakeDbWithChanges(changes: number): D1Database {
    return {
      prepare: () => ({
        bind: () => ({ run: async () => ({ meta: { changes } }) }),
      }),
    } as unknown as D1Database;
  }

  it("requires authentication", async () => {
    const res = await handleUnsubscribe("1", fakeDb([]), null);
    expect(res.status).toBe(401);
  });

  it("rejects a non-numeric id", async () => {
    const res = await handleUnsubscribe("not-a-number", fakeDb([]), PAID_USER);
    expect(res.status).toBe(400);
  });

  it("returns 404 when nothing matched (wrong owner or missing row)", async () => {
    const res = await handleUnsubscribe("1", fakeDbWithChanges(0), PAID_USER);
    expect(res.status).toBe(404);
  });

  it("returns 204 when the row was deleted", async () => {
    const res = await handleUnsubscribe("1", fakeDbWithChanges(1), PAID_USER);
    expect(res.status).toBe(204);
  });
});

describe("handlePushSubscription", () => {
  function pushSubRequest(body: unknown): Request {
    return new Request("https://example.com/api/push-subscription", { method: "POST", body: JSON.stringify(body) });
  }

  it("requires a paid user", async () => {
    const res = await handlePushSubscription(pushSubRequest({}), fakeDb([]), null);
    expect(res.status).toBe(402);
  });

  it("rejects a malformed subscription", async () => {
    const res = await handlePushSubscription(
      pushSubRequest({ endpoint: "not-a-url", keys: { p256dh: "x", auth: "y" } }),
      fakeDb([]),
      PAID_USER,
    );
    expect(res.status).toBe(400);
  });

  it("upserts a valid subscription and binds the authenticated user's id", async () => {
    const returningRow = { id: 1, user_id: "u1", endpoint: "https://push.example.com/abc", p256dh: "x", auth: "y", failure_count: 0 };
    const { db, calls } = fakeDbCapturing(returningRow);

    const res = await handlePushSubscription(
      pushSubRequest({ endpoint: "https://push.example.com/abc", keys: { p256dh: "x", auth: "y" } }),
      db,
      PAID_USER,
    );

    expect(res.status).toBe(204);
    expect(calls[0][0]).toBe("u1");
    expect(calls[0][1]).toBe("https://push.example.com/abc");
  });
});

/** Returns canned responses to successive `db.prepare(...).bind(...).first()/.run()` calls,
 *  in the exact order the handler under test is expected to make them — simpler than teaching
 *  a fake to parse SQL text when the call sequence for a given handler is fixed and known. */
function sequentialDb(responses: Array<{ first?: unknown; run?: unknown }>): D1Database {
  let i = 0;
  return {
    prepare: () => {
      const response = responses[i++] ?? {};
      return {
        bind: () => ({
          first: async () => response.first ?? null,
          run: async () => response.run ?? { success: true, meta: {} },
        }),
      };
    },
  } as unknown as D1Database;
}

function fakeEmail() {
  return { send: vi.fn().mockResolvedValue({}) };
}

describe("handleRequestLogin", () => {
  function loginRequest(body: unknown): Request {
    return new Request("https://example.com/api/login", { method: "POST", body: JSON.stringify(body) });
  }

  it("rejects an invalid email without touching the db", async () => {
    const res = await handleRequestLogin(loginRequest({ email: "not-an-email" }), {
      DB: sequentialDb([]),
      EMAIL: fakeEmail() as unknown as SendEmail,
    });
    expect(res.status).toBe(400);
  });

  it("responds ok without sending mail when the email matches no account", async () => {
    const email = fakeEmail();
    const res = await handleRequestLogin(loginRequest({ email: "nobody@example.com" }), {
      DB: sequentialDb([{ first: null }]), // getUserByEmail -> not found
      EMAIL: email as unknown as SendEmail,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(email.send).not.toHaveBeenCalled();
  });

  it("sends a sign-in email when the account exists and is under the rate limit", async () => {
    const email = fakeEmail();
    const res = await handleRequestLogin(loginRequest({ email: "a@b.com" }), {
      DB: sequentialDb([
        { first: { id: "u1", email: "a@b.com", bearer_token: "tok" } }, // getUserByEmail
        { first: { n: 0 } }, // countRecentLoginTokens
        { run: { success: true } }, // createLoginToken's INSERT
      ]),
      EMAIL: email as unknown as SendEmail,
    });
    expect(res.status).toBe(200);
    expect(email.send).toHaveBeenCalledTimes(1);
    const [sent] = email.send.mock.calls[0];
    expect(sent.to).toBe("a@b.com");
    expect(sent.from).toEqual({ email: "noreply@drumandbytes.ee", name: "Teeolud" });
  });

  it("responds ok but skips sending once the rate limit is hit", async () => {
    const email = fakeEmail();
    const res = await handleRequestLogin(loginRequest({ email: "a@b.com" }), {
      DB: sequentialDb([
        { first: { id: "u1", email: "a@b.com", bearer_token: "tok" } }, // getUserByEmail
        { first: { n: 3 } }, // countRecentLoginTokens — at the cap
      ]),
      EMAIL: email as unknown as SendEmail,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(email.send).not.toHaveBeenCalled();
  });
});

describe("handleVerifyLogin", () => {
  it("requires a token", async () => {
    const res = await handleVerifyLogin(new Request("https://example.com/api/login/verify"), sequentialDb([]));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid, expired, or already-used token", async () => {
    const res = await handleVerifyLogin(
      new Request("https://example.com/api/login/verify?token=bad"),
      sequentialDb([{ first: null }]), // consumeLoginToken's UPDATE...RETURNING affects no row
    );
    expect(res.status).toBe(400);
  });

  it("exchanges a valid token for the account's existing bearer_token", async () => {
    const res = await handleVerifyLogin(
      new Request("https://example.com/api/login/verify?token=good"),
      sequentialDb([
        { first: { user_id: "u1" } }, // consumeLoginToken's UPDATE...RETURNING
        { first: { id: "u1", bearer_token: "existing-tok" } }, // the SELECT users WHERE id = ?
      ]),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bearerToken: "existing-tok" });
  });
});
