import { authenticatePaidUser } from "./src/auth";
import { corsHeaders, handlePreflight, isAllowedOrigin } from "./src/cors";
import { handleCameraImage, handleCameras } from "./src/routes/cameras";
import { handleCheckout } from "./src/routes/checkout";
import { handleHazards } from "./src/routes/hazards";
import { handleStripeWebhook } from "./src/routes/stripe-webhook";
import { handleSubscribe, handleUnsubscribe } from "./src/routes/subscribe";
import { handleVms } from "./src/routes/vms";
import { handleWeatherStations } from "./src/routes/weather";

interface Env {
  DB: D1Database;
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

  // Paid-gated routes.
  const cameraImageMatch = pathname.match(/^\/api\/cameras\/([^/]+)\/image$/);
  if (method === "GET" && cameraImageMatch) {
    const user = await authenticatePaidUser(env.DB, request);
    return handleCameraImage(cameraImageMatch[1], user, env.DB);
  }
  if (method === "GET" && pathname === "/api/vms") {
    const user = await authenticatePaidUser(env.DB, request);
    return handleVms(env.DB, user);
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

  // Stripe integration.
  if (method === "POST" && pathname === "/api/checkout") {
    return handleCheckout(request);
  }
  if (method === "POST" && pathname === "/api/stripe-webhook") {
    return handleStripeWebhook(request);
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
