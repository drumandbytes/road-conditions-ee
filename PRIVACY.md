# Privacy Policy

**Status: DRAFT — not yet published or linked from the app.** This needs your review before
it goes live, and the items marked `[PLACEHOLDER]` below need filling in once the OÜ is
registered. This document is not legal advice; if anything here matters enough that being
wrong would hurt, get it checked before launch.

**Effective date:** `[PLACEHOLDER — set when published]`

## 1. Who this is about

This policy covers **Teesilm** (roadconditions.drumandbytes.ee), a road-conditions map for
Estonia. It does not cover other drumandbytes.\* properties, which have their own policies.

## 2. Data controller

`[PLACEHOLDER: once the OÜ is registered, name it here with registry code and address. Until
then, the controller is Maris Popens, reachable at maris@popens.lv.]`

## 3. What we collect

Teesilm is built to need as little of your data as possible. Specifically:

| Category | What | Why it's collected |
|---|---|---|
| **Account** | Email address, an opaque account ID and auth token | Identifies your account. There is no password — sign-in is a one-time emailed link, or created automatically when you subscribe via Stripe. |
| **Saved locations** | A label you choose, a latitude/longitude, a radius (0.5–50 km), optional hazard-type filters | Powers your location-based alerts — this is the core paid feature, and the most sensitive data we hold: it can reveal where you live or work. |
| **Push notification data** | Your browser's push subscription endpoint and encryption keys | Needed to deliver alerts to your device. This is issued by your browser, not by us. |
| **Billing** | Subscription status, and a reference ID pointing to your Stripe customer record | Determines whether you have paid-tier access. **We never see or store your card details** — Stripe's own hosted checkout and billing portal handle all payment collection; we only receive a status update afterward. |
| **Email preferences** | Whether you've opted in to product-update emails; billing and service-announcement emails cannot be turned off while you have an account | Respects your choice on non-essential email. |
| **Technical (not stored)** | Your IP address is read briefly to enforce rate limits on a few endpoints (checkout, address search) and is not written to any database. | Abuse prevention. |

We do **not** collect passwords (there aren't any), payment card numbers, or precise device
fingerprints beyond the push-subscription endpoint above.

### What we deliberately don't do

Teesilm uses [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) for basic
traffic numbers (how many people visit, roughly how long, which pages). It's cookieless, sets
no persistent identifier, and can't be tied back to your account or any individual visitor —
which is also why the app doesn't show you a cookie-consent banner.

## 4. Third parties we share data with

| Who | What they get | Why |
|---|---|---|
| **Stripe** | Email, payment details (collected directly by them, never by us) | Payment processing, subscription billing |
| **Cloudflare** | All of the above (they host the database, servers, and send our emails) | Infrastructure — database (D1), compute (Workers), transactional email (magic links, billing notices), cookieless analytics |
| **OpenStreetMap Nominatim** | Whatever you type into the search box, plus your IP (used transiently, not stored by us) | Turning a place name into a map location. Not linked to your account. |
| **Your browser's push service** (Google, Mozilla, Apple, etc., depending on your browser) | The alert content, delivered to your push subscription endpoint | Required by the Web Push standard — there's no way to deliver a push notification without going through the browser vendor's own infrastructure |

We do not sell data, and we do not use it for advertising — Teesilm doesn't run ads.

## 5. Legal basis (GDPR)

- **Contract** (Art. 6(1)(b)): account data, saved locations, push subscriptions, billing —
  all necessary to provide the service you're paying for or have signed up for.
- **Legitimate interest** (Art. 6(1)(f)): rate-limiting IPs to prevent abuse; cookieless
  aggregate analytics.
- **Consent** (Art. 6(1)(a)): the optional product-update email preference.

## 6. Retention

We keep account data for as long as your account exists. If you stop paying, your account and
saved data are **not** automatically deleted — cancelling a subscription only stops billing.
You can permanently delete your account and everything tied to it (saved locations, push
subscriptions, sign-in history, email preferences) yourself, at any time, from the account
panel in the app — no need to email anyone. Deleting your account also cancels any active
subscription, so you won't be billed again.

## 7. Your rights

Under GDPR, you can ask us to:

- **Access** the data we hold about you
- **Correct** it if it's wrong
- **Delete** it ("right to be forgotten") — self-serve in the app (§6), no need to contact us
- **Export** it in a portable format
- **Object to or restrict** processing

For anything other than deletion, contact us (§8) and we'll respond within 30 days.

## 8. Contact

`[PLACEHOLDER — set to the OÜ's contact email once registered; maris@popens.lv until then]`

## 9. Changes to this policy

If this policy changes materially, we'll update the effective date above and, for
account-holders, note it in a service-announcement email (which can't be opted out of, for
exactly this reason).
