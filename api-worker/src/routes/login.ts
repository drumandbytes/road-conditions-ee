import { consumeLoginToken, countRecentLoginTokens, createLoginToken, getUserByEmail } from "../db";
import { buildEmailHtml, FROM_ADDRESS, FRONTEND_URL } from "../emailTemplate";

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

function buildLoginEmailHtml(link: string, ttlMinutes: number): string {
  return buildEmailHtml({
    introHtml: `<p style="margin:16px 0;">Sisselogimiseks vajuta nupule (link kehtib ${ttlMinutes} minutit):</p>`,
    button: { label: "Logi sisse", href: link },
    footerHtml:
      `<p style="margin:0 0 16px 0; word-break:break-all;">Kui nupp ei tööta, kopeeri see link brauserisse:<br /><a href="${link}" style="color:#2e9bff;">${link}</a></p>` +
      '<p style="margin:0;">Kui sa seda ise ei küsinud, võid selle kirja lihtsalt eirata.</p>',
  });
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
          from: { email: FROM_ADDRESS, name: "Teesilm" },
          to: email,
          subject: "Sisselogimislink — Teesilm",
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
