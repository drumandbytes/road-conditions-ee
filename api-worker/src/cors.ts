// CORS restricted to the frontend's own origin only — never a wildcard, per the plan's
// "expose as little as possible" security principle.
//
// isAllowedOrigin checks against a pattern rather than one exact string, since Cloudflare
// Pages preview deployments get a unique hash subdomain every deploy
// (e.g. https://a8001fbf.road-conditions-ee.pages.dev) — hardcoding one would break on the
// next deploy. Matches the production alias, any preview subdomain, and localhost dev
// (Vite's default port) explicitly; nothing else.
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/([a-z0-9]+\.)?road-conditions-ee\.pages\.dev$/,
  /^https:\/\/roadconditions\.drumandbytes\.ee$/,
  /^http:\/\/localhost:5173$/,
];

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(origin!) });
}
