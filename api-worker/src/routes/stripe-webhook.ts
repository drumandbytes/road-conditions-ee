import Stripe from "stripe";
import { updateSubscriptionStatusByStripeCustomerId, upsertUserFromStripe } from "../db";

function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): string {
  return stripeStatus === "active" || stripeStatus === "trialing" ? "active" : "canceled";
}

/** Authoritative source of truth for ongoing subscription state (renewals, payment failures,
 *  cancellations) — anything that happens when the user isn't sitting on our return page, so
 *  there's no request from them to piggyback the update onto (unlike checkout.ts's session
 *  handler, which is the fast path for the initial token issuance right after payment). */
export async function handleStripeWebhook(
  request: Request,
  env: { STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; DB: D1Database },
): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: "Payments are not configured yet" }, { status: 503 });
  }
  const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

  const signature = request.headers.get("Stripe-Signature");
  const body = await request.text();
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    // constructEventAsync (not constructEvent) — required in Workers, since Stripe's default
    // signature verification uses Node's synchronous crypto APIs that aren't available here.
    event = await stripe.webhooks.constructEventAsync(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err instanceof Error ? err.message : err);
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (customerId) {
        await upsertUserFromStripe(env.DB, {
          stripeCustomerId: customerId,
          email: session.customer_details?.email ?? null,
          subscriptionStatus: "active",
        });
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : mapStripeStatus(subscription.status);
      await updateSubscriptionStatusByStripeCustomerId(env.DB, customerId, status);
      break;
    }
    default:
      break; // Ignore event types we don't care about — Stripe expects a 200 regardless.
  }

  return Response.json({ received: true });
}
