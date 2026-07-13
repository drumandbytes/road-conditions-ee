import { authenticatePaidUser } from "./src/auth";
import { corsHeaders, handlePreflight, isAllowedOrigin } from "./src/cors";
import { handleCameraImage, handleCameras } from "./src/routes/cameras";
import { handleCheckout, handleCheckoutSession, handlePortal } from "./src/routes/checkout";
import { handleGeocode } from "./src/routes/geocode";
import { handleHazards } from "./src/routes/hazards";
import { handleRequestLogin, handleVerifyLogin } from "./src/routes/login";
import { handlePushSubscription } from "./src/routes/push-subscription";
import { handleRestrictions } from "./src/routes/restrictions";
import { handleStripeWebhook } from "./src/routes/stripe-webhook";
import { handleListSavedPoints, handleSubscribe, handleUnsubscribe } from "./src/routes/subscribe";
import { handleVms } from "./src/routes/vms";
import { handleWeatherStations } from "./src/routes/weather";
import { handleWeatherStationHistory } from "./src/routes/weather-history";

interface Env {
  DB: D1Database;
  EMAIL: SendEmail;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const response = await route(request, env);
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
    return handleGeocode(request);
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
