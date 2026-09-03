import { afterEach, describe, expect, it, vi } from "vitest";
import { withEdgeCache } from "../src/edge-cache";

function stubCache() {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (req: Request) => {
      const hit = store.get(new URL(req.url).pathname);
      return hit ? hit.clone() : undefined;
    }),
    put: vi.fn(async (req: Request, res: Response) => {
      store.set(new URL(req.url).pathname, res);
    }),
  };
  vi.stubGlobal("caches", { default: cache });
  return cache;
}

const ctx = { waitUntil: (p: Promise<unknown>) => void p } as ExecutionContext;
const req = new Request("https://api.example.com/api/hazards", {
  headers: { Authorization: "Bearer tok" },
});

afterEach(() => vi.unstubAllGlobals());

describe("withEdgeCache", () => {
  it("runs the handler on a miss, stamps Cache-Control, and stores the response", async () => {
    const cache = stubCache();
    const handler = vi.fn(async () => Response.json({ ok: 1 }));

    const res = await withEdgeCache(req, ctx, 90, handler);

    expect(handler).toHaveBeenCalledOnce();
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=90");
    expect(cache.put).toHaveBeenCalledOnce();
    // Path-only key — the Authorization header must not reach the stored request.
    expect(cache.put.mock.calls[0][0].headers.get("Authorization")).toBeNull();
  });

  it("serves a hit without invoking the handler", async () => {
    stubCache();
    const first = vi.fn(async () => Response.json({ n: 1 }));
    await withEdgeCache(req, ctx, 90, first);

    const second = vi.fn(async () => Response.json({ n: 2 }));
    const res = await withEdgeCache(req, ctx, 90, second);

    expect(second).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ n: 1 });
    // Headers must stay mutable — the outer CORS layer sets more on the way out.
    expect(() => res.headers.set("Access-Control-Allow-Origin", "x")).not.toThrow();
  });

  it("passes non-ok responses through without caching them", async () => {
    const cache = stubCache();
    const handler = vi.fn(async () => Response.json({ error: "boom" }, { status: 500 }));

    const res = await withEdgeCache(req, ctx, 90, handler);

    expect(res.status).toBe(500);
    expect(cache.put).not.toHaveBeenCalled();
  });
});
