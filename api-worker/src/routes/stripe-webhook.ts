import Stripe from "stripe";
import { sendPaymentFailedEmail, sendRenewalReminderEmail, sendSubscriptionEndedEmail } from "../billingEmails";
import { getUserByStripeCustomerId, updateEmailPreferences, updateSubscriptionStatusByStripeCustomerId, upsertUserFromStripe } from "../db";

function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): string {
  return stripeStatus === "active" || stripeStatus === "trialing" ? "active" : "canceled";
}

interface StripeWebhookEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  DB: D1Database;
  EMAIL: SendEmail;
  UNSUBSCRIBE_SECRET?: string;
}

/** Authoritative source of truth for ongoing subscription state (renewals, payment failures,
 *  cancellations) — anything that happens when the user isn't sitting on our return page, so
 *  there's no request from them to piggyback the update onto (unlike checkout.ts's session
 *  handler, which is the fast path for the initial token issuance right after payment). Also
 *  where the three billing emails (renewal reminder, payment failed, subscription ended) get
 *  triggered from, for the same reason — there's no request to piggyback a response onto. */
export async function handleStripeWebhook(request: Request, env: StripeWebhookEnv): Promise<Response> {
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
        const user = await upsertUserFromStripe(env.DB, {
          stripeCustomerId: customerId,
          email: session.customer_details?.email ?? null,
          subscriptionStatus: "active",
        });
        // Consent checkbox lives in our own pre-checkout UI, not Stripe's hosted page —
        // Stripe's own built-in promotions-consent collection is US-merchant-only (confirmed
        // against its docs), and Checkout custom_fields has no checkbox type at all. See
        // checkout.ts for where this metadata key gets set.
        if (session.metadata?.productUpdatesOptIn !== undefined) {
          await updateEmailPreferences(env.DB, user.id, {
            productUpdates: session.metadata.productUpdatesOptIn === "true",
          });
        }
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : mapStripeStatus(subscription.status);
      await updateSubscriptionStatusByStripeCustomerId(env.DB, customerId, status);

      if (event.type === "customer.subscription.deleted") {
        const user = await getUserByStripeCustomerId(env.DB, customerId);
        if (user) await sendSubscriptionEndedEmail(env, user);
      }
      break;
    }
    // Stripe sends this a few days before any charge that renews a subscription — including
    // the very first post-trial charge, not just later recurring ones — making it a single
    // event to hook for "renewal reminder" regardless of where in the subscription's
    // lifecycle it is.
    case "invoice.upcoming": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const renewalTimestamp = invoice.period_end;
      if (customerId && renewalTimestamp) {
        const user = await getUserByStripeCustomerId(env.DB, customerId);
        if (user) {
          const amountEur = `${(invoice.amount_due / 100).toFixed(2)} €`;
          const renewalDate = new Date(renewalTimestamp * 1000).toLocaleDateString("et-EE");
          await sendRenewalReminderEmail(env, user, amountEur, renewalDate);
        }
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      if (customerId) {
        const user = await getUserByStripeCustomerId(env.DB, customerId);
        if (user) await sendPaymentFailedEmail(env, user);
      }
      break;
    }
    default:
      break; // Ignore event types we don't care about — Stripe expects a 200 regardless.
  }

  return Response.json({ received: true });
}
