import { useEffect, useState } from "preact/hooks";
import { BEARER_TOKEN_CHANGED_EVENT, getAccountStatus, startCheckout, startPortalSession } from "../lib/api";
import type { AccountStatus, Plan } from "../lib/api";

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
      planYearly: string;
      trialNote: string;
      activeBody: string;
      lifetimeBody: string;
      manageButton: string;
      error: string;
    };
  };
}

const PLAN_LABEL_KEYS = {
  monthly: "planMonthly",
  yearly: "planYearly",
} as const satisfies Record<Plan, keyof AccountPanelProps["t"]["account"]>;

export function AccountPanel({ t }: AccountPanelProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busy, setBusy] = useState(false);

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
      window.location.href = await startCheckout(plan);
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

  return (
    <>
      <h2>{t.account.title}</h2>
      {state.status === "loading" && <p>…</p>}
      {state.status === "error" && <p>{t.account.error}</p>}
      {state.status === "signedOut" && (
        <>
          <p>{t.account.subscribeBody}</p>
          <div class="account-plans">
            {(Object.keys(PLAN_LABEL_KEYS) as Plan[]).map((plan) => (
              <button key={plan} type="button" class="account-button" onClick={() => onSubscribe(plan)} disabled={busy}>
                {t.account[PLAN_LABEL_KEYS[plan]]}
              </button>
            ))}
          </div>
          <p class="account-trial-note">{t.account.trialNote}</p>
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
    </>
  );
}
