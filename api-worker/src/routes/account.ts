import Stripe from "stripe";
import { deleteUser } from "../db";
import type { UserRow } from "../db";

/** Deletes the caller's own account and everything tied to it (saved points, push
 *  subscriptions, login tokens, email preferences — all cascade from the users row, see
 *  db.ts's deleteUser). Cancels any live Stripe subscription *first*: once the users row is
 *  gone we lose stripe_customer_id forever, so if cancellation failed silently after deletion
 *  there'd be no way to ever stop that billing again. If Stripe cancellation errors, the
 *  account is deliberately left intact and this returns an error — better to ask the caller to
 *  retry than to orphan an active subscription. */
export async function handleDeleteAccount(
  user: UserRow | null,
  env: { STRIPE_SECRET_KEY?: string; DB: D1Database },
): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (user.stripe_customer_id && env.STRIPE_SECRET_KEY) {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });
    try {
      // list() only returns non-canceled subscriptions by default — nothing to do if there
      // aren't any (e.g. already canceled, or a "lifetime" comp with no real Stripe billing).
      const subscriptions = await stripe.subscriptions.list({ customer: user.stripe_customer_id });
      await Promise.all(subscriptions.data.map((sub) => stripe.subscriptions.cancel(sub.id)));
    } catch (err) {
      console.error(
        `Failed to cancel Stripe subscription(s) for customer ${user.stripe_customer_id} during account deletion:`,
        err instanceof Error ? err.message : err,
      );
      return Response.json({ error: "Failed to cancel your subscription — please try again" }, { status: 502 });
    }
  }

  await deleteUser(env.DB, user.id);
  return Response.json({ success: true });
}
