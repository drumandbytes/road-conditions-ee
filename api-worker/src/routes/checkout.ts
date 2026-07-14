import Stripe from "stripe";
import { updateEmailPreferences, upsertUserFromStripe } from "../db";
import type { UserRow } from "../db";

// Matches the CORS allowlist's production origin (see cors.ts) — Stripe needs a real URL to
// redirect the browser back to after checkout, not something derived from the request (which
// could be spoofed to redirect elsewhere).
const FRONTEND_URL = "https://roadconditions.drumandbytes.ee";

export type Plan = "monthly" | "yearly";

const TRIAL_PERIOD_DAYS = 30;

// Deliberately no purchasable lifetime plan here — considered a one-time-payment tier but
// decided against selling it to the public: an indefinite commitment to an unknown number of
// strangers is a real, unbounded liability for a solo/early-stage project (infra costs only
// go up, e.g. once push notifications need Workers Paid). "lifetime" still exists as a
// subscription_status value for manually comping specific chosen people (self, friends) — see
// db.ts — that's a bounded, controlled risk, just never offered through Stripe checkout.
// Seasonal/promotional discounts on the plans below are handled entirely through Stripe's own
// coupon/promotion code system (dashboard-configured, allow_promotion_codes below) rather than
// custom code — no code changes needed per promotion.
const PLANS: Record<Plan, { amountEurCents: number; interval: "month" | "year" }> = {
  monthly: { amountEurCents: 299, interval: "month" },
  yearly: { amountEurCents: 2499, interval: "year" },
};

function stripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}

function isPlan(value: unknown): value is Plan {
  return value === "monthly" || value === "yearly";
}

/** Starts a new checkout for the chosen plan. No auth required — this is how a first-time
 *  subscriber begins; Stripe collects email and payment details on its own hosted page, we
 *  never see card data (per the plan's security principle). */
export async function handleCheckout(request: Request, env: { STRIPE_SECRET_KEY?: string }): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Payments are not configured yet" }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { plan?: unknown; productUpdatesOptIn?: unknown };
  if (!isPlan(body.plan)) {
    return Response.json({ error: "Invalid or missing plan" }, { status: 400 });
  }
  const plan = PLANS[body.plan];
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: { name: `Teesilm paid tier (${body.plan})` },
          unit_amount: plan.amountEurCents,
          recurring: { interval: plan.interval },
        },
        quantity: 1,
      },
    ],
    subscription_data: { trial_period_days: TRIAL_PERIOD_DAYS },
    allow_promotion_codes: true,
    // Carries the consent checkbox from our own pre-checkout UI (see SubscribeConsent in the
    // frontend) through to the webhook/session-completion handlers, which set
    // email_preferences.product_updates from it — Stripe Checkout has no native checkbox
    // custom field, and its built-in promotions-consent collection is US-merchant-only.
    metadata: { productUpdatesOptIn: body.productUpdatesOptIn === true ? "true" : "false" },
    success_url: `${FRONTEND_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${FRONTEND_URL}/?checkout=cancelled`,
  });

  if (!session.url) {
    return Response.json({ error: "Failed to create checkout session" }, { status: 502 });
  }
  return Response.json({ url: session.url });
}

/** Called by the frontend right after Stripe redirects back to success_url. Does the same
 *  upsert the webhook does (idempotent — see upsertUserFromStripe) rather than only reading,
 *  because the webhook is async and isn't guaranteed to have landed yet by the time the user
 *  is back on our page; this is the fast path that gets them their token immediately, the
 *  webhook remains the authoritative path for status changes after this point (renewals,
 *  cancellations) when there's no "user is on the page" moment to rely on. */
export async function handleCheckoutSession(
  sessionId: string,
  env: { STRIPE_SECRET_KEY?: string; DB: D1Database },
): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Payments are not configured yet" }, { status: 503 });
  }
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId || session.payment_status !== "paid") {
    return Response.json({ error: "Checkout session not completed" }, { status: 402 });
  }

  const user = await upsertUserFromStripe(env.DB, {
    stripeCustomerId: customerId,
    email: session.customer_details?.email ?? null,
    subscriptionStatus: "active",
  });
  // Same metadata read as the webhook's checkout.session.completed handler — done in both
  // places for the same reason upsertUserFromStripe is: this fast path isn't guaranteed to
  // run before or after the webhook, so either one might be the first (or only, if the other
  // is slow/fails) to actually apply it.
  if (session.metadata?.productUpdatesOptIn !== undefined) {
    await updateEmailPreferences(env.DB, user.id, {
      productUpdates: session.metadata.productUpdatesOptIn === "true",
    });
  }
  return Response.json({ bearerToken: user.bearer_token });
}

/** Redirects an already-subscribed user to Stripe's hosted Customer Portal — covers payment
 *  method updates and cancellation, so we don't build/maintain that UI ourselves (per the
 *  plan: "Stripe Checkout + Customer Portal as the entire account system"). Lifetime (comped)
 *  users have nothing to manage here (no recurring billing, no Stripe customer record at all
 *  in the common case), so this is only offered to regular subscribers on the frontend. */
export async function handlePortal(
  user: UserRow | null,
  env: { STRIPE_SECRET_KEY?: string },
): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Active subscription required" }, { status: 402 });
  }
  if (!env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Payments are not configured yet" }, { status: 503 });
  }
  if (!user.stripe_customer_id) {
    return Response.json({ error: "No billing account on file" }, { status: 404 });
  }
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: FRONTEND_URL,
  });
  return Response.json({ url: portalSession.url });
}
