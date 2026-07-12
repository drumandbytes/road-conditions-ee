import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeToTemplate, translateEstonianToEnglish, translateWithTemplateCache } from "../src/translate";

describe("normalizeToTemplate", () => {
  it("replaces a single number with an indexed placeholder", () => {
    expect(normalizeToTemplate("Kiirus piiratud 30 km/h.")).toEqual({
      template: "Kiirus piiratud {0} km/h.",
      values: ["30"],
    });
  });

  it("handles multiple numbers in order", () => {
    expect(normalizeToTemplate("Kruusatee remont km 5 kuni km 12.")).toEqual({
      template: "Kruusatee remont km {0} kuni km {1}.",
      values: ["5", "12"],
    });
  });

  it("leaves text with no numbers unchanged (template equals the text itself)", () => {
    expect(normalizeToTemplate("Operatiivsõidukitele on läbipääs tagatud.")).toEqual({
      template: "Operatiivsõidukitele on läbipääs tagatud.",
      values: [],
    });
  });

  it("handles decimal numbers", () => {
    expect(normalizeToTemplate("Teekonna pikenemine 4.5 km.")).toEqual({
      template: "Teekonna pikenemine {0} km.",
      values: ["4.5"],
    });
  });
});

function mockAi(translatedText: string) {
  return { run: vi.fn().mockResolvedValue({ translated_text: translatedText }) } as unknown as Ai;
}

function fakeDb(cachedRow: { source_template: string; translated_template: string } | null) {
  const inserted: unknown[][] = [];
  const db = {
    prepare: (sql: string) => {
      if (sql.startsWith("SELECT")) {
        return { bind: () => ({ first: async () => cachedRow }) };
      }
      return { bind: (...args: unknown[]) => ({ run: async () => { inserted.push(args); return { success: true }; } }) };
    },
  } as unknown as D1Database;
  return { db, inserted };
}

describe("translateWithTemplateCache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses a cached template translation without calling AI, substituting in the new value", async () => {
    const { db } = fakeDb({ source_template: "Kiirus piiratud {0} km/h.", translated_template: "Speed limited to {0} km/h." });
    const ai = mockAi("should not be called");

    const result = await translateWithTemplateCache(db, ai, "Kiirus piiratud 50 km/h.", { remaining: 5 });

    expect(result).toBe("Speed limited to 50 km/h.");
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("calls AI on a cache miss and stores a derived template when the number survives translation", async () => {
    const { db, inserted } = fakeDb(null);
    const ai = mockAi("Speed is limited to 30 km/h.");

    const result = await translateWithTemplateCache(db, ai, "Kiirus piiratud 30 km/h.", { remaining: 5 });

    expect(result).toBe("Speed is limited to 30 km/h.");
    expect(ai.run).toHaveBeenCalledOnce();
    expect(inserted[0]).toEqual(["Kiirus piiratud {0} km/h.", "Speed is limited to {0} km/h."]);
  });

  it("does not cache a template when the model drops or alters the number", async () => {
    const { db, inserted } = fakeDb(null);
    // Model translated but didn't preserve "30" verbatim (e.g. spelled out or reformatted).
    const ai = mockAi("Speed is limited.");

    const result = await translateWithTemplateCache(db, ai, "Kiirus piiratud 30 km/h.", { remaining: 5 });

    expect(result).toBe("Speed is limited."); // still returns the real translation
    expect(inserted).toHaveLength(0); // just doesn't generalize it into a reusable template
  });

  it("returns null without caching anything when translation itself fails", async () => {
    const { db, inserted } = fakeDb(null);
    const ai = { run: vi.fn().mockRejectedValue(new Error("model unavailable")) } as unknown as Ai;

    const result = await translateWithTemplateCache(db, ai, "Kiirus piiratud 30 km/h.", { remaining: 5 });

    expect(result).toBeNull();
    expect(inserted).toHaveLength(0);
  });

  it("returns null without calling AI when the budget is exhausted, on a cache miss", async () => {
    const { db, inserted } = fakeDb(null);
    const ai = mockAi("should not be called");

    const result = await translateWithTemplateCache(db, ai, "Kiirus piiratud 30 km/h.", { remaining: 0 });

    expect(result).toBeNull();
    expect(ai.run).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it("still serves a cache hit even when the budget is exhausted", async () => {
    const { db } = fakeDb({ source_template: "Kiirus piiratud {0} km/h.", translated_template: "Speed limited to {0} km/h." });
    const ai = mockAi("should not be called");

    const result = await translateWithTemplateCache(db, ai, "Kiirus piiratud 50 km/h.", { remaining: 0 });

    expect(result).toBe("Speed limited to 50 km/h.");
    expect(ai.run).not.toHaveBeenCalled();
  });
});

describe("translateEstonianToEnglish", () => {
  it("sends source_lang et and target_lang en", async () => {
    const ai = mockAi("Hello");
    await translateEstonianToEnglish(ai, "Tere");
    expect(ai.run).toHaveBeenCalledWith(
      "@cf/meta/m2m100-1.2b",
      expect.objectContaining({ text: "Tere", source_lang: "et", target_lang: "en" }),
    );
  });

  it("returns null instead of throwing when the model call fails", async () => {
    const ai = { run: vi.fn().mockRejectedValue(new Error("boom")) } as unknown as Ai;
    const result = await translateEstonianToEnglish(ai, "Tere");
    expect(result).toBeNull();
  });
});
