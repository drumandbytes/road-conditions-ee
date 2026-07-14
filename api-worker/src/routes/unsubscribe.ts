import { updateEmailPreferences } from "../db";
import type { EmailPreferences } from "../db";
import { verifyUnsubscribeToken } from "../unsubscribe";

type Category = "productUpdates" | "serviceAnnouncements" | "billing" | "all";

function isValidCategory(value: string | null): value is Category {
  return value === "productUpdates" || value === "serviceAnnouncements" || value === "billing" || value === "all";
}

const CATEGORY_LABELS: Record<Exclude<Category, "all">, string> = {
  productUpdates: "Uued funktsioonid ja uuendused",
  serviceAnnouncements: "Katkestused ja olulised muudatused",
  billing: "Arved ja tellimuse teated",
};

// uid/sig only ever reach renderPage after passing HMAC verification, which in practice
// constrains them to hex/base64url charsets no legitimate value could escape an HTML
// attribute with — but that's an implicit property of how signing works today, not something
// this function can see. Escaping explicitly means this stays safe even if that reasoning
// chain (or the verification code) ever changes, at zero real cost.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Server-rendered, no client JS — a one-click unsubscribe link needs to work even if the
// email client's in-app browser blocks scripts, and this is simple enough not to need any.
// Estonian-only, matching the emails these links appear in (see login.ts/billing emails) —
// this app's locale switcher is a client-side, in-app-only concept with nothing to key a
// standalone emailed link off of.
function renderPage(prefs: EmailPreferences, uid: string, sig: string, message: string): string {
  const checkbox = (key: keyof typeof CATEGORY_LABELS) => `
    <label style="display:flex; align-items:center; gap:0.6rem; padding:0.6rem 0; font-size:15px; color:#1a1a1a;">
      <input type="checkbox" name="${key}" ${prefs[key] ? "checked" : ""} style="width:18px; height:18px;" />
      ${CATEGORY_LABELS[key]}
    </label>`;

  return `<!doctype html>
<html lang="et">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Teavituste eelistused — Teesilm</title>
  </head>
  <body style="margin:0; padding:32px 16px; background:#f0f0f3; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:420px; margin:0 auto; background:#ffffff; border-radius:16px; padding:32px;">
      <div style="width:48px; height:48px; margin:0 auto 16px auto; background:#2e9bff; border-radius:12px; color:#ffffff; font-size:24px; font-weight:700; line-height:48px; text-align:center;">T</div>
      <h1 style="margin:0 0 4px 0; font-size:20px; font-weight:700; color:#1a1a1a; text-align:center;">Teesilm</h1>
      <p style="color:#1a1a1a; font-size:15px; line-height:1.5; text-align:center; margin:16px 0;">${escapeHtml(message)}</p>
      <form method="POST" action="/api/unsubscribe">
        <input type="hidden" name="uid" value="${escapeHtml(uid)}" />
        <input type="hidden" name="sig" value="${escapeHtml(sig)}" />
        ${checkbox("productUpdates")}
        ${checkbox("serviceAnnouncements")}
        ${checkbox("billing")}
        <button type="submit" style="width:100%; margin-top:20px; background:#2e9bff; color:#ffffff; font-size:16px; font-weight:600; border:none; padding:14px; border-radius:10px; cursor:pointer;">
          Salvesta valikud
        </button>
      </form>
    </div>
  </body>
</html>`;
}

function htmlResponse(html: string): Response {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Reached by clicking an unsubscribe link in an email — applies that one link's category (or
 *  all three, for "unsubscribe from everything") immediately, then shows a page where the
 *  categories can be adjusted further, matching the "specific categories or all" pattern most
 *  unsubscribe pages offer. No login required, by design (see unsubscribe.ts's own comment) —
 *  authenticated instead by the signed uid+sig pair the link itself carries. */
export async function handleUnsubscribeGet(request: Request, env: { DB: D1Database; UNSUBSCRIBE_SECRET?: string }): Promise<Response> {
  if (!env.UNSUBSCRIBE_SECRET) return new Response("Not configured", { status: 503 });

  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  const sig = url.searchParams.get("sig");
  const category = url.searchParams.get("category");
  if (!uid || !sig || !isValidCategory(category)) return new Response("Invalid link", { status: 400 });

  const valid = await verifyUnsubscribeToken(env.UNSUBSCRIBE_SECRET, uid, sig);
  if (!valid) return new Response("Invalid or expired link", { status: 400 });

  const patch: Partial<EmailPreferences> =
    category === "all"
      ? { productUpdates: false, serviceAnnouncements: false, billing: false }
      : { [category]: false };
  const prefs = await updateEmailPreferences(env.DB, uid, patch);

  const message =
    category === "all"
      ? "Oled loobunud kõikidest teavituskirjadest. Vajadusel saad allolevast valida, mida siiski soovid saada."
      : `Oled loobunud: ${CATEGORY_LABELS[category]}. Vajadusel kohanda oma eelistusi allpool.`;
  return htmlResponse(renderPage(prefs, uid, sig, message));
}

/** Submitted from the form on the page above — lets someone pick exactly which categories
 *  they want rather than only "this one" or "everything". */
export async function handleUnsubscribePost(request: Request, env: { DB: D1Database; UNSUBSCRIBE_SECRET?: string }): Promise<Response> {
  if (!env.UNSUBSCRIBE_SECRET) return new Response("Not configured", { status: 503 });

  const form = await request.formData().catch(() => null);
  const uid = form?.get("uid")?.toString();
  const sig = form?.get("sig")?.toString();
  if (!uid || !sig) return new Response("Invalid link", { status: 400 });

  const valid = await verifyUnsubscribeToken(env.UNSUBSCRIBE_SECRET, uid, sig);
  if (!valid) return new Response("Invalid or expired link", { status: 400 });

  // Unchecked checkboxes are simply absent from FormData, not sent as "false" — presence is
  // the signal.
  const prefs = await updateEmailPreferences(env.DB, uid, {
    productUpdates: form!.get("productUpdates") === "on",
    serviceAnnouncements: form!.get("serviceAnnouncements") === "on",
    billing: form!.get("billing") === "on",
  });

  return htmlResponse(renderPage(prefs, uid, sig, "Eelistused salvestatud."));
}
