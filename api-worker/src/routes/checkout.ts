import Stripe from "stripe";
import { upsertUserFromStripe } from "../db";
import type { UserRow } from "../db";

// Matches the CORS allowlist's production origin (see cors.ts) — Stripe needs a real URL to
// redirect the browser back to after checkout, not something derived from the request (which
// could be spoofed to redirect elsewhere).
const FRONTEND_URL = "https://roadconditions.drumandbytes.ee";

const SUBSCRIPTION_PRICE_EUR_CENTS = 299; // €2.99/month

function stripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}

/** Starts a new subscription checkout. No auth required — this is how a first-time
 *  subscriber begins; Stripe collects email and payment details on its own hosted page, we
 *  never see card data (per the plan's security principle). */
export async function handleCheckout(env: { STRIPE_SECRET_KEY?: string }): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Payments are not configured yet" }, { status: 503 });
  }
  const stripe = stripeClient(env.STRIPE_SECRET_KEY);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: { name: "Teeolud paid tier" },
          unit_amount: SUBSCRIPTION_PRICE_EUR_CENTS,
          recurring: { interval: "month" },
        },
        quantity: 1,
      },
    ],
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
  return Response.json({ bearerToken: user.bearer_token });
}

/** Redirects an already-subscribed user to Stripe's hosted Customer Portal — covers payment
 *  method updates and cancellation, so we don't build/maintain that UI ourselves (per the
 *  plan: "Stripe Checkout + Customer Portal as the entire account system"). */
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
