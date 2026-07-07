/** Phase 3 work: Stripe webhook handler — verifies the event signature, updates
 *  subscription_status, issues the opaque bearer token. Not implemented yet. */
export async function handleStripeWebhook(_request: Request): Promise<Response> {
  return Response.json({ error: "Not implemented yet — Phase 3 work" }, { status: 501 });
}
