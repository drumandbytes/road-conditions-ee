// Worker responses aren't CDN-cached by default, so every hit on the free map endpoints was a
// cold D1 query — N concurrent users, N reads, for data the ingest cron only refreshes every
// few minutes. This wraps a handler in caches.default so repeated identical reads collapse to
// ~1 per TTL window per edge location.

/**
 * Cache key is path-only (no query, no headers). apiFetch attaches an Authorization header
 * even to these public routes; Cloudflare's default cache skips any request carrying one, so a
 * synthetic key is what makes these cacheable at all. CORS headers are applied after route()
 * in the outer fetch wrapper, so they're correctly not part of what's stored here.
 */
export async function withEdgeCache(
  request: Request,
  ctx: ExecutionContext,
  ttlSeconds: number,
  handler: () => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  // A cached Response has immutable headers; copy it so the outer CORS layer can still add
  // its per-origin headers.
  if (hit) return new Response(hit.body, hit);

  const fresh = await handler();
  if (!fresh.ok) return fresh;

  const cached = new Response(fresh.body, fresh);
  cached.headers.set("Cache-Control", `public, s-maxage=${ttlSeconds}`);
  ctx.waitUntil(cache.put(cacheKey, cached.clone()));
  return cached;
}
