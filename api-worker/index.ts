import { authenticatePaidUser, authenticateUser } from "./src/auth";
import { handleDeleteAccount } from "./src/routes/account";
import { corsHeaders, handlePreflight, isAllowedOrigin } from "./src/cors";
import { handleCameraImage, handleCameras } from "./src/routes/cameras";
import { handleCheckout, handleCheckoutSession, handlePortal } from "./src/routes/checkout";
import { handleGetEmailPreferences, handleUpdateEmailPreferences } from "./src/routes/email-preferences";
import { handleGeocode } from "./src/routes/geocode";
import { handleHazards } from "./src/routes/hazards";
import { handleRequestLogin, handleVerifyLogin } from "./src/routes/login";
import { handleDeletePushSubscription, handlePushSubscription } from "./src/routes/push-subscription";
import { handleRestrictions } from "./src/routes/restrictions";
import { handleStripeWebhook } from "./src/routes/stripe-webhook";
import { handleListSavedPoints, handleSubscribe, handleUnsubscribe } from "./src/routes/subscribe";
import { handleUnsubscribeGet, handleUnsubscribePost } from "./src/routes/unsubscribe";
import { handleVms } from "./src/routes/vms";
import { handleWeatherStations } from "./src/routes/weather";
import { handleWeatherStationHistory } from "./src/routes/weather-history";

interface Env {
  DB: D1Database;
  EMAIL: SendEmail;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  UNSUBSCRIBE_SECRET?: string;
  GEOCODE_RATE_LIMITER?: RateLimit;
  CHECKOUT_RATE_LIMITER?: RateLimit;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    let response: Response;
    try {
      response = await route(request, env);
    } catch (err) {
      // Without this, an uncaught exception anywhere in route() skips the CORS-header logic
      // below entirely — the browser then reports an opaque CORS failure instead of surfacing
      // whatever actually went wrong.
      console.error("[api-worker] unhandled error:", err instanceof Error ? err.stack : err);
      response = Response.json({ error: "Internal server error" }, { status: 500 });
    }
    const origin = request.headers.get("Origin");
    if (isAllowedOrigin(origin)) {
      for (const [key, value] of Object.entries(corsHeaders(origin!))) {
        response.headers.set(key, value);
      }
    }
    return response;
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  // Free, cached reads — no auth required.
  if (method === "GET" && pathname === "/api/weather-stations") {
    return handleWeatherStations(env.DB);
  }
  if (method === "GET" && pathname === "/api/cameras") {
    return handleCameras(env.DB);
  }
  if (method === "GET" && pathname === "/api/hazards") {
    return handleHazards(env.DB);
  }
  if (method === "GET" && pathname === "/api/restrictions") {
    return handleRestrictions(env.DB);
  }
  if (method === "GET" && pathname === "/api/geocode") {
    return handleGeocode(request, env);
  }
  if (method === "POST" && pathname === "/api/login") {
    return handleRequestLogin(request, env);
  }
  if (method === "GET" && pathname === "/api/login/verify") {
    return handleVerifyLogin(request, env.DB);
  }

  // Paid-gated routes.
  const cameraImageMatch = pathname.match(/^\/api\/cameras\/([^/]+)\/image$/);
  if (method === "GET" && cameraImageMatch) {
    const user = await authenticatePaidUser(env.DB, request);
    return handleCameraImage(cameraImageMatch[1], user, env.DB);
  }
  const weatherHistoryMatch = pathname.match(/^\/api\/weather-stations\/([^/]+)\/history$/);
  if (method === "GET" && weatherHistoryMatch) {
    const user = await authenticatePaidUser(env.DB, request);
    return handleWeatherStationHistory(decodeURIComponent(weatherHistoryMatch[1]), user, env.DB);
  }
  if (method === "GET" && pathname === "/api/vms") {
    const user = await authenticatePaidUser(env.DB, request);
    return handleVms(env.DB, user);
  }
  if (method === "GET" && pathname === "/api/subscribe") {
    const user = await authenticatePaidUser(env.DB, request);
    return handleListSavedPoints(env.DB, user);
  }
  if (method === "POST" && pathname === "/api/subscribe") {
    const user = await authenticatePaidUser(env.DB, request);
    return handleSubscribe(request, env.DB, user);
  }
  const unsubscribeMatch = pathname.match(/^\/api\/subscribe\/([^/]+)$/);
  if (method === "DELETE" && unsubscribeMatch) {
    const user = await authenticatePaidUser(env.DB, request);
    return handleUnsubscribe(unsubscribeMatch[1], env.DB, user);
  }
  if (method === "POST" && pathname === "/api/push-subscription") {
    const user = await authenticatePaidUser(env.DB, request);
    return handlePushSubscription(request, env.DB, user);
  }
  if (method === "DELETE" && pathname === "/api/push-subscription") {
    const user = await authenticatePaidUser(env.DB, request);
    return handleDeletePushSubscription(request, env.DB, user);
  }
  if (method === "GET" && pathname === "/api/me") {
    const user = await authenticatePaidUser(env.DB, request);
    return user
      ? Response.json({ email: user.email, subscriptionStatus: user.subscription_status })
      : Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (method === "POST" && pathname === "/api/portal") {
    const user = await authenticatePaidUser(env.DB, request);
    return handlePortal(user, env);
  }
  if (method === "GET" && pathname === "/api/email-preferences") {
    const user = await authenticatePaidUser(env.DB, request);
    return handleGetEmailPreferences(env.DB, user);
  }
  if (method === "PATCH" && pathname === "/api/email-preferences") {
    const user = await authenticatePaidUser(env.DB, request);
    return handleUpdateEmailPreferences(request, env.DB, user);
  }
  // Not authenticatePaidUser — a canceled/free-tier accountholder still owns their account and
  // its data, and still has every right to delete it (see authenticateUser's own comment).
  if (method === "DELETE" && pathname === "/api/account") {
    const user = await authenticateUser(env.DB, request);
    return handleDeleteAccount(user, env);
  }

  // Public one-click unsubscribe — no auth (see unsubscribe.ts's own comment on why).
  if (method === "GET" && pathname === "/api/unsubscribe") {
    return handleUnsubscribeGet(request, env);
  }
  if (method === "POST" && pathname === "/api/unsubscribe") {
    return handleUnsubscribePost(request, env);
  }

  // Stripe integration.
  if (method === "POST" && pathname === "/api/checkout") {
    return handleCheckout(request, env);
  }
  if (method === "GET" && pathname === "/api/checkout/session") {
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return Response.json({ error: "Missing session_id" }, { status: 400 });
    return handleCheckoutSession(sessionId, env);
  }
  if (method === "POST" && pathname === "/api/stripe-webhook") {
    return handleStripeWebhook(request, env);
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
