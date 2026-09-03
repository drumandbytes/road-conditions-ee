import { getCameraById, getCameras } from "../db";
import type { UserRow } from "../db";

/** Free tier: camera locations only, visible to everyone. Deliberately builds properties
 *  from named fields rather than spreading the row, so image_url (paid-tier only) can never
 *  leak into this response even if CameraRow grows more paid-tier columns later. */
export async function handleCameras(db: D1Database): Promise<Response> {
  const cameras = await getCameras(db);
  const geojson = {
    type: "FeatureCollection",
    features: cameras.map((c) => ({
      type: "Feature",
      properties: { id: c.id, name: c.name },
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
    })),
  };
  return Response.json(geojson);
}

// Cache proxied images briefly rather than hitting Tark Tee on every request — its own feed
// only updates cameras every ~10 minutes (see ingest-worker's tarktee.ts), so a short TTL
// here doesn't serve stale images in practice.
const IMAGE_CACHE_TTL_SECONDS = 60;

/** Paid tier: proxies the camera's live image from Tark Tee. Never redirects straight to
 *  Tark Tee's URL (see plan's security principle: upstream links stay server-side only). */
export async function handleCameraImage(
  cameraId: string,
  user: UserRow | null,
  db: D1Database,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Live camera images require an active subscription" }, { status: 402 });
  }

  const camera = await getCameraById(db, cameraId);
  if (!camera || !camera.image_url) {
    return Response.json({ error: "Camera not found" }, { status: 404 });
  }

  const cache = caches.default;
  const cacheKey = new Request(camera.image_url);
  let upstream = await cache.match(cacheKey);
  if (!upstream) {
    upstream = await fetch(camera.image_url);
    if (!upstream.ok) {
      return Response.json({ error: "Camera image unavailable" }, { status: 502 });
    }
    upstream = new Response(upstream.body, upstream);
    upstream.headers.set("Cache-Control", `public, max-age=${IMAGE_CACHE_TTL_SECONDS}`);
    ctx.waitUntil(cache.put(cacheKey, upstream.clone()));
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
      // Let the browser serve CameraModal's 60 s poll from its own cache instead of
      // round-tripping the worker each time.
      "Cache-Control": `public, max-age=${IMAGE_CACHE_TTL_SECONDS}`,
    },
  });
}
