import { getEmailPreferences } from "./db";
import type { UserRow } from "./db";
import { buildEmailHtml, FROM_ADDRESS, FRONTEND_URL } from "./emailTemplate";
import { buildUnsubscribeLink } from "./unsubscribe";

interface BillingEmailEnv {
  DB: D1Database;
  EMAIL: SendEmail;
  UNSUBSCRIBE_SECRET?: string;
}

// Shared by all three billing emails below — checks the "billing" preference (respecting an
// unsubscribe), builds the unsubscribe-link footer, and sends. Callers only provide the
// subject/body that's actually different between renewal/payment-failed/ended.
async function sendBillingEmail(
  env: BillingEmailEnv,
  user: UserRow,
  subject: string,
  introHtml: string,
  introText: string,
  button: { label: string; href: string },
): Promise<void> {
  if (!user.email) return;
  const prefs = await getEmailPreferences(env.DB, user.id);
  if (!prefs.billing) return;

  let footerHtml = '<p style="margin:0;">See on automaatne teade sinu Teeolud tellimuse kohta.</p>';
  let footerText = "See on automaatne teade sinu Teeolud tellimuse kohta.";
  if (env.UNSUBSCRIBE_SECRET) {
    const unsubscribeLink = await buildUnsubscribeLink(env.UNSUBSCRIBE_SECRET, user.id, "billing");
    footerHtml += `<p style="margin:8px 0 0 0;"><a href="${unsubscribeLink}" style="color:#6e6e73;">Halda teavituste eelistusi</a></p>`;
    footerText += `\n\nTeavituste eelistuste haldamiseks: ${unsubscribeLink}`;
  }

  try {
    await env.EMAIL.send({
      from: { email: FROM_ADDRESS, name: "Teeolud" },
      to: user.email,
      subject,
      text: `${introText}\n\n${button.label}: ${button.href}\n\n${footerText}`,
      html: buildEmailHtml({ introHtml, button, footerHtml }),
    });
  } catch (err) {
    console.error(`[api-worker] failed to send billing email (${subject}):`, err instanceof Error ? err.message : err);
  }
}

export async function sendRenewalReminderEmail(
  env: BillingEmailEnv,
  user: UserRow,
  amountEur: string,
  renewalDate: string,
): Promise<void> {
  const text = `Sinu Teeolud tellimus pikeneb ${renewalDate}, summas ${amountEur}.`;
  await sendBillingEmail(env, user, "Tellimuse pikendamine — Teeolud", `<p style="margin:16px 0;">${text}</p>`, text, {
    label: "Halda tellimust",
    href: `${FRONTEND_URL}/`,
  });
}

export async function sendPaymentFailedEmail(env: BillingEmailEnv, user: UserRow): Promise<void> {
  const text = "Sinu viimane makse ebaõnnestus. Palun uuenda oma maksevahendit, et tellimus jätkuks katkestuseta.";
  await sendBillingEmail(env, user, "Makse ebaõnnestus — Teeolud", `<p style="margin:16px 0;">${text}</p>`, text, {
    label: "Uuenda maksevahendit",
    href: `${FRONTEND_URL}/`,
  });
}

export async function sendSubscriptionEndedEmail(env: BillingEmailEnv, user: UserRow): Promise<void> {
  const text =
    "Sinu Teeolud tellimus on lõppenud. Otsepildid kaameratest, liiklusmärkide reaalajas info ja teised tasulised funktsioonid ei ole enam saadaval.";
  await sendBillingEmail(env, user, "Tellimus on lõppenud — Teeolud", `<p style="margin:16px 0;">${text}</p>`, text, {
    label: "Telli uuesti",
    href: `${FRONTEND_URL}/`,
  });
}
