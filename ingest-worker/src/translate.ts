// Machine translation for free-text fields that only ever come from Tark Tee in Estonian (no
// English variant exists anywhere upstream — confirmed directly, this isn't a structured
// DATEX MultilingualString field, just a contractor-entered string). Uses Workers AI's
// open-weights M2M-100 model.
const SOURCE_LANG = "et";
const TARGET_LANG = "en";
const MODEL = "@cf/meta/m2m100-1.2b";

interface M2M100Response {
  translated_text?: string;
}

export async function translateEstonianToEnglish(ai: Ai, text: string): Promise<string | null> {
  try {
    const result = (await ai.run(MODEL, {
      text,
      source_lang: SOURCE_LANG,
      target_lang: TARGET_LANG,
    })) as M2M100Response;
    return result.translated_text ?? null;
  } catch (err) {
    console.error("[ingest-worker] translation failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;

// Replaces every digit sequence with an indexed placeholder ({0}, {1}, ...) so texts that
// differ only by a number — confirmed a real, common pattern: "Kiirus piiratud 30 km/h." /
// "...50 km/h." / "...70 km/h." accounted for 19 of 265 real restriction texts sampled, all
// otherwise identical — collapse to one cached translation instead of one AI call each.
export function normalizeToTemplate(text: string): { template: string; values: string[] } {
  const values: string[] = [];
  const template = text.replace(NUMBER_PATTERN, (match) => {
    values.push(match);
    return `{${values.length - 1}}`;
  });
  return { template, values };
}

function fillTemplate(template: string, values: string[]): string {
  return template.replace(/\{(\d+)\}/g, (_, i) => values[Number(i)] ?? "");
}

// Verified directly (real Workers AI calls against real restriction text): M2M-100 preserves
// digit sequences verbatim in its output ("30" stays "30", not spelled out or reformatted) —
// this substitution-based reconstruction depends on that holding.
function deriveTranslatedTemplate(translated: string, values: string[]): string | null {
  let result = translated;
  for (let i = 0; i < values.length; i++) {
    if (!result.includes(values[i])) return null; // model dropped/altered a number — don't cache a broken mapping
    result = result.replace(values[i], `{${i}}`);
  }
  return result;
}

export interface TranslationCacheRow {
  source_template: string;
  translated_template: string;
}

// Shared, mutable budget of real AI calls left in this Worker invocation. Confirmed directly
// in production: Workers AI calls count against the Free plan's 50-external-subrequests-per-
// invocation ceiling (same pool as every fetch() this invocation makes — weather, hazards,
// restrictions, detours), not a separate AI-specific limit. A cold-start batch of ~180 distinct
// texts blew through it immediately ("Too many subrequests by single Worker invocation").
// Cache hits don't touch this budget — only genuine misses that reach the model do.
export interface TranslationBudget {
  remaining: number;
}

/** Translates `text`, reusing a cached template-level translation across any restriction
 *  whose text differs only by embedded numbers, instead of re-translating each one. Falls
 *  back to a real AI call (and caches the result as a template, when the numbers survive
 *  translation intact) on a cache miss — unless the budget is exhausted, in which case this
 *  returns null and the caller's own retry logic (extra_info_en left null) picks it up on a
 *  later poll instead. */
export async function translateWithTemplateCache(
  db: D1Database,
  ai: Ai,
  text: string,
  budget: TranslationBudget,
): Promise<string | null> {
  const { template, values } = normalizeToTemplate(text);

  const cached = await db
    .prepare("SELECT translated_template FROM translations WHERE source_template = ?")
    .bind(template)
    .first<{ translated_template: string }>();
  if (cached) return fillTemplate(cached.translated_template, values);

  if (budget.remaining <= 0) return null;
  budget.remaining--;

  const translated = await translateEstonianToEnglish(ai, text);
  if (translated === null) return null;

  const translatedTemplate = deriveTranslatedTemplate(translated, values);
  if (translatedTemplate !== null) {
    await db
      .prepare("INSERT OR IGNORE INTO translations (source_template, translated_template) VALUES (?, ?)")
      .bind(template, translatedTemplate)
      .run();
  }

  return translated;
}
