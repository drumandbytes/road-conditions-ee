import Stripe from "stripe";
import { upsertUserFromStripe } from "../db";
import type { UserRow } from "../db";

// Matches the CORS allowlist's production origin (see cors.ts) — Stripe needs a real URL to
// redirect the browser back to after checkout, not something derived from the request (which
// could be spoofed to redirect elsewhere).
const FRONTEND_URL = "https://roadconditions.drumandbytes.ee";

export type Plan = "monthly" | "yearly" | "lifetime";

const TRIAL_PERIOD_DAYS = 30;

// Lifetime starts cheap deliberately (early-supporter pricing while the project is unproven)
// — expected to go up over time as adoption grows, not a permanent price. Seasonal/promo
// discounts on top of any of these are handled entirely through Stripe's own coupon/promotion
// code system (dashboard-configured, allow_promotion_codes below) rather than custom code —
// that covers one-off ideas like "3 months for the price of one" too, no code changes needed
// per promotion.
const PLANS: Record<
  Plan,
  { mode: "subscription" | "payment"; amountEurCents: number; interval?: "month" | "year" }
> = {
  monthly: { mode: "subscription", amountEurCents: 299, interval: "month" },
  yearly: { mode: "subscription", amountEurCents: 2499, interval: "year" },
  lifetime: { mode: "payment", amountEurCents: 4900 },
};

function stripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}

function isPlan(value: unknown): value is Plan {
  return value === "monthly" || value === "yearly" || value === "lifetime";
}

/** Starts a new checkout for the chosen plan. No auth required — this is how a first-time
 *  subscriber begins; Stripe collects email and payment details on its own hosted page, we
 *  never see card data (per the plan's security principle). */
export async function handleCheckout(request: Request, env: { STRIPE_SECRET_KEY?: string }): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Payments are not configured yet" }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { plan?: unknown };
  if (!isPlan(body.plan)) {
    return Response.json({ error: "Invalid or missing plan" }, { status: 400 });
  }
  const plan = PLANS[body.plan];
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);

  const session = await stripe.checkout.sessions.create({
    mode: plan.mode,
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: { name: `Teeolud paid tier (${body.plan})` },
          unit_amount: plan.amountEurCents,
          ...(plan.interval ? { recurring: { interval: plan.interval } } : {}),
        },
        quantity: 1,
      },
    ],
    // Trial only makes sense for a recurring plan — a one-time lifetime payment has nothing
    // to trial, you're just buying it. Stripe rejects trial_period_days on mode: "payment".
    ...(plan.mode === "subscription" ? { subscription_data: { trial_period_days: TRIAL_PERIOD_DAYS } } : {}),
    // A one-time payment doesn't create a Customer by default unless something else requires
    // it — force it so we always get a stripe_customer_id back to key our upsert on, same as
    // subscription mode already does implicitly.
    ...(plan.mode === "payment" ? { customer_creation: "always" as const } : {}),
    allow_promotion_codes: true,
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
    // mode: "payment" (one-time) vs "subscription" is how we tell a lifetime purchase apart
    // from a recurring one — a lifetime buyer has no Stripe subscription object at all, so
    // it'll never generate a customer.subscription.* webhook that could otherwise flip a
    // regular subscriber's status; nothing ever downgrades a "lifetime" row automatically.
    subscriptionStatus: session.mode === "payment" ? "lifetime" : "active",
  });
  return Response.json({ bearerToken: user.bearer_token });
}

/** Redirects an already-subscribed user to Stripe's hosted Customer Portal — covers payment
 *  method updates and cancellation, so we don't build/maintain that UI ourselves (per the
 *  plan: "Stripe Checkout + Customer Portal as the entire account system"). Lifetime users
 *  have nothing to manage here (no recurring billing to cancel), so this is only offered to
 *  regular subscribers on the frontend — reaching this route as a lifetime user isn't harmful,
 *  Stripe's portal will just show them an account with no active subscription. */
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
