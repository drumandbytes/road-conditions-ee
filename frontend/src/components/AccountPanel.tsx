import { useEffect, useState } from "preact/hooks";
import { BEARER_TOKEN_CHANGED_EVENT, deleteAccount, getAccountStatus, startCheckout, startPortalSession } from "../lib/api";
import type { AccountStatus, Plan } from "../lib/api";
import { EmailPreferencesSection } from "./EmailPreferencesSection";
import type { EmailPreferencesT } from "./EmailPreferencesSection";
import { FeatureComparisonTable } from "./FeatureComparisonTable";
import type { FeatureComparisonT } from "./FeatureComparisonTable";
import { SavedPointsSection } from "./SavedPointsSection";
import type { SavedPointsSectionT } from "./SavedPointsSection";
import { SignInForm } from "./SignInForm";
import type { SignInFormT } from "./SignInForm";

type LoadState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "active"; account: AccountStatus }
  | { status: "lifetime"; account: AccountStatus }
  | { status: "error" };

interface AccountPanelProps {
  t: {
    account: {
      title: string;
      subscribeBody: string;
      planMonthly: string;
      planMonthlyUnit: string;
      planYearly: string;
      planYearlyUnit: string;
      trialTag: string;
      trialNote: string;
      statusActive: string;
      statusLifetime: string;
      activeBody: string;
      lifetimeBody: string;
      manageButton: string;
      adminPanelButton: string;
      error: string;
      signedInAs: string;
      productUpdatesOptInLabel: string;
      deleteAccountButton: string;
      deleteAccountPrompt: string;
      deleteAccountConfirmButton: string;
      deleteAccountCancelButton: string;
      deleteAccountError: string;
    } & FeatureComparisonT;
    savedPoints: SavedPointsSectionT;
    signIn: SignInFormT;
    emailPreferences: EmailPreferencesT;
  };
  savedPointsRefreshKey: number;
  onAddSavedPoint: () => void;
}

type AccountKey = keyof AccountPanelProps["t"]["account"];

const PLAN_LABEL_KEYS = {
  monthly: { price: "planMonthly", unit: "planMonthlyUnit" },
  yearly: { price: "planYearly", unit: "planYearlyUnit" },
} as const satisfies Record<Plan, { price: AccountKey; unit: AccountKey }>;

export function AccountPanel({ t, savedPointsRefreshKey, onAddSavedPoint }: AccountPanelProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  // Opt-in, unchecked by default — captured here (not on Stripe's hosted Checkout page, which
  // has no native checkbox custom field and whose built-in promotions-consent collection is
  // US-merchant-only) and carried through to checkout.session's metadata, see checkout.ts.
  const [productUpdatesOptIn, setProductUpdatesOptIn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      setState({ status: "loading" });
      getAccountStatus()
        .then((account) => {
          if (cancelled) return;
          if (!account) {
            setState({ status: "signedOut" });
          } else if (account.subscriptionStatus === "lifetime") {
            setState({ status: "lifetime", account });
          } else {
            setState({ status: "active", account });
          }
        })
        .catch(() => {
          if (!cancelled) setState({ status: "error" });
        });
    };

    refresh();
    // Re-checks after app.tsx sets a fresh token post-checkout — this component's own mount-time
    // fetch races that (mount-time effects fire before app.tsx's checkout-completion effect
    // resolves), so without this it would keep showing "signedOut" right after a successful
    // subscribe until the next full page load.
    window.addEventListener(BEARER_TOKEN_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(BEARER_TOKEN_CHANGED_EVENT, refresh);
    };
  }, []);

  async function onSubscribe(plan: Plan) {
    setBusy(true);
    try {
      window.location.href = await startCheckout(plan, productUpdatesOptIn);
    } catch {
      setState({ status: "error" });
      setBusy(false);
    }
  }

  async function onManage() {
    setBusy(true);
    try {
      window.location.href = await startPortalSession();
    } catch {
      setState({ status: "error" });
      setBusy(false);
    }
  }

  async function onDeleteAccount() {
    setDeleting(true);
    setDeleteError(false);
    try {
      await deleteAccount();
      // deleteAccount() already cleared the local token and fired BEARER_TOKEN_CHANGED_EVENT,
      // which this component's own effect listens for — that's what moves state back to
      // "signedOut", not this call directly.
    } catch {
      setDeleteError(true);
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div class="account-header">
        <h2>{t.account.title}</h2>
        {state.status === "active" && <span class="status-badge status-badge-active">{t.account.statusActive}</span>}
        {state.status === "lifetime" && <span class="status-badge status-badge-lifetime">{t.account.statusLifetime}</span>}
      </div>

      {(state.status === "active" || state.status === "lifetime") && state.account.email && (
        <p class="account-email">
          {t.account.signedInAs} <strong>{state.account.email}</strong>
        </p>
      )}

      {(state.status === "active" || state.status === "lifetime") && state.account.isAdmin && (
        <a href="/admin/" class="account-button account-button-secondary account-admin-link">
          {t.account.adminPanelButton}
        </a>
      )}

      {state.status === "loading" && <div class="account-skeleton" aria-hidden="true" />}

      {state.status === "error" && <p class="account-alert account-alert-error">{t.account.error}</p>}

      {state.status === "signedOut" && (
        <>
          <p>{t.account.subscribeBody}</p>
          <div class="plan-cards">
            {(Object.keys(PLAN_LABEL_KEYS) as Plan[]).map((plan) => (
              <button key={plan} type="button" class="plan-card" onClick={() => onSubscribe(plan)} disabled={busy}>
                <span class="plan-card-price">
                  {t.account[PLAN_LABEL_KEYS[plan].price]}
                  <span class="plan-card-unit">{t.account[PLAN_LABEL_KEYS[plan].unit]}</span>
                </span>
                <span class="plan-card-trial">{t.account.trialTag}</span>
              </button>
            ))}
          </div>
          <div class="account-signup-extras">
            <p class="account-trial-note">{t.account.trialNote}</p>
            <label class="category-item">
              <input
                type="checkbox"
                checked={productUpdatesOptIn}
                onChange={() => setProductUpdatesOptIn((v) => !v)}
              />
              <span class="category-item-text">
                <span class="category-item-label">{t.account.productUpdatesOptInLabel}</span>
              </span>
            </label>
            <FeatureComparisonTable t={t.account} />
            <SignInForm t={t.signIn} />
          </div>
        </>
      )}

      {state.status === "active" && (
        <>
          <p>{t.account.activeBody}</p>
          <button type="button" class="account-button" onClick={onManage} disabled={busy}>
            {t.account.manageButton}
          </button>
        </>
      )}

      {state.status === "lifetime" && <p>{t.account.lifetimeBody}</p>}

      {(state.status === "active" || state.status === "lifetime") && (
        <SavedPointsSection
          t={t.savedPoints}
          refreshKey={savedPointsRefreshKey}
          onAddSavedPoint={onAddSavedPoint}
        />
      )}

      {(state.status === "active" || state.status === "lifetime") && (
        <EmailPreferencesSection t={t.emailPreferences} />
      )}

      {(state.status === "active" || state.status === "lifetime") && (
        <div class="account-danger-zone">
          {deleteError && <p class="account-alert account-alert-error">{t.account.deleteAccountError}</p>}
          {!confirmingDelete && (
            <button
              type="button"
              class="account-button account-button-danger"
              onClick={() => setConfirmingDelete(true)}
            >
              {t.account.deleteAccountButton}
            </button>
          )}
          {confirmingDelete && (
            <>
              <p class="account-alert account-alert-error">{t.account.deleteAccountPrompt}</p>
              <div class="account-danger-zone-actions">
                <button
                  type="button"
                  class="account-button account-button-secondary"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                >
                  {t.account.deleteAccountCancelButton}
                </button>
                <button
                  type="button"
                  class="account-button account-button-danger"
                  onClick={onDeleteAccount}
                  disabled={deleting}
                >
                  {t.account.deleteAccountConfirmButton}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
