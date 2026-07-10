import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWeatherStations } from "../src/routes/weather";
import { handleCameraImage, handleCameras } from "../src/routes/cameras";
import { handleHazards } from "../src/routes/hazards";
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
