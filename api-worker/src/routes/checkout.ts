/** Phase 3 work: Stripe Checkout session creation. Not implemented yet — see plan's
 *  "Phase 3 — Stripe + accounts" section. Confirmed during planning that stripe-node has
 *  native Cloudflare Workers support via Stripe.createFetchHttpClient(), no node_compat
 *  needed on v11.10.0+ (already in package.json as a dependency, unused until this lands). */
export async function handleCheckout(_request: Request): Promise<Response> {
  return Response.json({ error: "Not implemented yet — Phase 3 work" }, { status: 501 });
}
