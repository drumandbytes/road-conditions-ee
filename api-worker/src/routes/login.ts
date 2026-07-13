import { consumeLoginToken, countRecentLoginTokens, createLoginToken, getUserByEmail } from "../db";

// Matches checkout.ts's own duplicate of this constant — see that file's comment on why it's
// hardcoded rather than derived from the request.
const FRONTEND_URL = "https://roadconditions.drumandbytes.ee";
const FROM_ADDRESS = "noreply@drumandbytes.ee";

const LOGIN_TOKEN_TTL_MINUTES = 15;
// Caps how many sign-in emails one account can trigger in a short window — protects against
// someone hammering /api/login with a stranger's address (annoying, and eventually looks like
// spam to whatever inbox provider is on the receiving end), without needing a dedicated
// rate-limiting binding (Durable Objects, KV) for what's a low-volume, low-value target.
const MAX_LOGIN_REQUESTS_PER_WINDOW = 3;
const RATE_LIMIT_WINDOW_MINUTES = 15;

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Inline styles and a table layout throughout — email clients (Outlook/Gmail in particular)
// strip <style> blocks and ignore flexbox/grid, so this is the only markup that renders
// consistently across them. Colors are hardcoded hex rather than pulled from index.css's CSS
// variables since those aren't available in an email context.
function buildLoginEmailHtml(link: string, ttlMinutes: number): string {
  return `<!doctype html>
<html lang="et">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0; padding:0; background:#f0f0f3; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f3; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:#ffffff; border-radius:16px; overflow:hidden;">
            <tr>
              <td style="padding:36px 32px 8px 32px; text-align:center;">
                <div style="width:48px; height:48px; margin:0 auto 16px auto; background:#2e9bff; border-radius:12px; color:#ffffff; font-size:24px; font-weight:700; line-height:48px;">T</div>
                <h1 style="margin:0; font-size:20px; font-weight:700; color:#1a1a1a;">Teeolud</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px; text-align:center; color:#1a1a1a; font-size:16px; line-height:1.5;">
                <p style="margin:16px 0;">Sisselogimiseks vajuta nupule (link kehtib ${ttlMinutes} minutit):</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px; text-align:center;">
                <a href="${link}" style="display:inline-block; background:#2e9bff; color:#ffffff; font-size:16px; font-weight:600; text-decoration:none; padding:14px 32px; border-radius:10px;">Logi sisse</a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px; text-align:center; color:#6e6e73; font-size:13px; line-height:1.5; word-break:break-all;">
                <p style="margin:0 0 24px 0;">Kui nupp ei tööta, kopeeri see link brauserisse:<br /><a href="${link}" style="color:#2e9bff;">${link}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 32px 32px; border-top:1px solid #f0f0f3; text-align:center; color:#6e6e73; font-size:13px; line-height:1.5;">
                <p style="margin:16px 0 0 0;">Kui sa seda ise ei küsinud, võid selle kirja lihtsalt eirata.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Requests a magic sign-in link for a *second* device on an already-paying account — the
 *  bearer_token itself is only ever shown once, right after checkout, so this is the only
 *  other way to retrieve it. Always responds the same way regardless of whether the email
 *  matched an account or was rate-limited, so this endpoint can't be used to check which
 *  emails have an account, or how close to the limit one is. */
export async function handleRequestLogin(request: Request, env: { DB: D1Database; EMAIL: SendEmail }): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = (body as Record<string, unknown> | null)?.email;
  if (!isValidEmail(email)) {
    return Response.json({ error: "Invalid email" }, { status: 400 });
  }

  const user = await getUserByEmail(env.DB, email);
  if (user) {
    const recentCount = await countRecentLoginTokens(env.DB, user.id, RATE_LIMIT_WINDOW_MINUTES);
    if (recentCount < MAX_LOGIN_REQUESTS_PER_WINDOW) {
      const token = await createLoginToken(env.DB, user.id, LOGIN_TOKEN_TTL_MINUTES);
      const link = `${FRONTEND_URL}/?login_token=${token}`;
      try {
        await env.EMAIL.send({
          from: { email: FROM_ADDRESS, name: "Teeolud" },
          to: email,
          subject: "Sisselogimislink — Teeolud",
          text:
            `Sisselogimiseks vajuta lingile (kehtib ${LOGIN_TOKEN_TTL_MINUTES} minutit):\n\n${link}\n\n` +
            "Kui sa seda ise ei küsinud, võid selle kirja lihtsalt eirata.",
          html: buildLoginEmailHtml(link, LOGIN_TOKEN_TTL_MINUTES),
        });
      } catch (err) {
        // Logged, not surfaced — the response below is identical either way (see the
        // function's own doc comment on why), and a delivery failure here is something to
        // notice in logs, not something the caller can act on.
        console.error("[api-worker] failed to send login email:", err instanceof Error ? err.message : err);
      }
    }
  }

  return Response.json({ ok: true });
}

/** Exchanges a valid, unused, unexpired login token for the account's existing bearer_token.
 *  Never rotates it — other devices already signed in on this account keep working. */
export async function handleVerifyLogin(request: Request, db: D1Database): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return Response.json({ error: "Missing token" }, { status: 400 });
  }

  const user = await consumeLoginToken(db, token);
  if (!user || !user.bearer_token) {
    return Response.json({ error: "Invalid or expired link" }, { status: 400 });
  }

  return Response.json({ bearerToken: user.bearer_token });
}
