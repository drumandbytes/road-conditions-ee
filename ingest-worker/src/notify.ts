// Matches newly-changed hazards/restrictions against users' saved points and sends Web Push
// notifications for anything that matches — see push.ts for the actual send, geo.ts for the
// distance/category matching logic, and index.ts's pollFast for where this is invoked (as the
// LAST step in the cycle, after every other fetch/AI call has already run, so it only spends
// whatever's left of the 50-subrequest-per-invocation budget rather than starving earlier,
// more time-sensitive steps).
import type { Restriction } from "./arcgis";
import {
  deletePushSubscription,
  getPushSubscriptionsByUserIds,
  getSavedPointsForMatching,
  markHazardsNotified,
  markRestrictionsNotified,
  recordPushFailure,
  type PushSubscriptionRow,
} from "./db";
import { matchingSavedPoints, type SavedPoint } from "./geo";
import { sendWebPush, type PushPayload } from "./push";
import type { HazardRecord } from "./tarktee";

export interface PushBudget {
  remaining: number;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const APP_URL = "https://roadconditions.drumandbytes.ee";

// Estonian only — push subscriptions aren't tied to a stored locale preference (out of scope
// for v1; the map/UI itself is bilingual, but the audience for a Tark Tee alternative is
// overwhelmingly Estonian speakers, matching this repo's default locale elsewhere).
const HAZARD_LABEL_ET: Record<string, string> = {
  slippery: "Libe tee",
  obstacle: "Takistus teel",
  accident: "Õnnetus",
  roadworks: "Teetööd",
  reduced_visibility: "Halb nähtavus",
  blockage: "Tee sulgemine",
  weather: "Erakorralised ilmastikuolud",
};

const RESTRICTION_EFFECT_LABEL_ET: Record<string, string> = {
  SPEED_LIMITED: "Kiirus piiratud",
  OTHER: "Piirang",
  ONE_WAY_CLOSED: "Üks sõidusuund suletud",
  LANE_CLOSED: "Sõidurada suletud",
  COMPLETE_CLOSURE: "Täielik sulgemine",
};

function buildHazardPayload(hazard: HazardRecord): PushPayload {
  return {
    title: HAZARD_LABEL_ET[hazard.eventType] ?? hazard.eventType,
    body: hazard.description ?? "Uus teavitus sinu salvestatud asukoha lähedal.",
    url: APP_URL,
  };
}

function buildRestrictionPayload(restriction: Restriction): PushPayload {
  const label = RESTRICTION_EFFECT_LABEL_ET[restriction.effect ?? ""] ?? "Piirang";
  const road = restriction.roadName ?? "Tee";
  return { title: label, body: `${road} lähedal`, url: APP_URL };
}

interface NotifiableItem {
  lat: number;
  lng: number;
  eventType: string;
  kind: "hazard" | "restriction";
  markKey: string | number;
  payload: PushPayload;
}

export async function notifyMatchingSavedPoints(
  db: D1Database,
  vapidKeys: VapidKeys | null,
  changedHazards: HazardRecord[],
  changedRestrictions: Restriction[],
  budget: PushBudget,
): Promise<void> {
  if (changedHazards.length === 0 && changedRestrictions.length === 0) return;
  if (!vapidKeys) {
    console.log("[ingest-worker] push matching skipped — VAPID_PRIVATE_KEY not configured yet");
    return;
  }

  const pointRows = await getSavedPointsForMatching(db);
  if (pointRows.length === 0) return; // nothing to match — cheap to just recheck next cycle

  const points: SavedPoint[] = pointRows.map((p) => ({
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    radiusKm: p.radius_km,
    eventTypes: p.event_types ? (JSON.parse(p.event_types) as string[]) : null,
  }));
  const ownerByPointId = new Map(pointRows.map((p) => [p.id, p.user_id]));

  const items: NotifiableItem[] = [
    ...changedHazards.map(
      (h): NotifiableItem => ({
        lat: h.lat,
        lng: h.lng,
        eventType: h.eventType,
        kind: "hazard",
        markKey: h.externalId,
        payload: buildHazardPayload(h),
      }),
    ),
    // Restrictions with no effect set have nothing meaningful to alert about.
    ...changedRestrictions
      .filter((r) => r.effect)
      .map(
        (r): NotifiableItem => ({
          lat: r.lat,
          lng: r.lng,
          eventType: r.effect!,
          kind: "restriction",
          markKey: r.id,
          payload: buildRestrictionPayload(r),
        }),
      ),
  ];

  const notifiedHazardIds: string[] = [];
  const notifiedRestrictionIds: number[] = [];

  // Cache push_subscriptions lookups per user across this batch — the same user's saved
  // points can match multiple items in one cycle, no reason to refetch their devices each time.
  const subscriptionsByUser = new Map<string, PushSubscriptionRow[]>();
  async function subscriptionsFor(userId: string): Promise<PushSubscriptionRow[]> {
    let subs = subscriptionsByUser.get(userId);
    if (!subs) {
      subs = await getPushSubscriptionsByUserIds(db, [userId]);
      subscriptionsByUser.set(userId, subs);
    }
    return subs;
  }

  for (const item of items) {
    const matches = matchingSavedPoints({ lat: item.lat, lng: item.lng, eventType: item.eventType }, points);

    const markNotified = () => {
      if (item.kind === "hazard") notifiedHazardIds.push(item.markKey as string);
      else notifiedRestrictionIds.push(item.markKey as number);
    };

    if (matches.length === 0) {
      markNotified(); // nothing to send, but handled — avoids rechecking forever
      continue;
    }

    const ownerIds = [...new Set(matches.map((p) => ownerByPointId.get(p.id)!))];
    const subscriptionLists = await Promise.all(ownerIds.map((userId) => subscriptionsFor(userId)));
    const subscriptions = subscriptionLists.flat();

    if (subscriptions.length === 0) {
      markNotified(); // matched saved points exist, but no registered device to send to
      continue;
    }

    if (budget.remaining < subscriptions.length) {
      // Not enough budget left to notify every matched device for this item — stop here
      // entirely (this item and anything after it stays unnotified) rather than partially
      // fanning out, so the retry next cycle (3 minutes later) is a clean full attempt rather
      // than "some devices already got it, some didn't." Accepted tradeoff per the plan: a
      // budget cutoff mid-batch risks a few duplicate notifications on retry, which is safer
      // than silently dropping some recipients.
      break;
    }

    for (const sub of subscriptions) {
      budget.remaining--;
      const result = await sendWebPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        item.payload,
        vapidKeys.publicKey,
        vapidKeys.privateKey,
      );
      if (!result.success) {
        if (result.statusCode === 404 || result.statusCode === 410) {
          await deletePushSubscription(db, sub.id);
        } else if (result.statusCode && result.statusCode >= 500) {
          await recordPushFailure(db, sub.id);
        }
        // 429 (transient) and 413 (payload-construction bug, not a subscription problem) are
        // intentionally left untouched — see push.ts / the plan's RFC 8030 handling notes.
      }
    }

    markNotified();
  }

  await markHazardsNotified(db, notifiedHazardIds);
  await markRestrictionsNotified(db, notifiedRestrictionIds);
}
