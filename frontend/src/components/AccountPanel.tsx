import { useEffect, useState } from "preact/hooks";
import { BEARER_TOKEN_CHANGED_EVENT, getAccountStatus, startCheckout, startPortalSession } from "../lib/api";
import type { AccountStatus } from "../lib/api";

type LoadState = { status: "loading" } | { status: "signedOut" } | { status: "active"; account: AccountStatus } | { status: "error" };

interface AccountPanelProps {
  t: {
    account: {
      title: string;
      subscribeBody: string;
      subscribeButton: string;
      activeBody: string;
      manageButton: string;
      error: string;
    };
  };
}

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
          setState(account && account.subscriptionStatus === "active" ? { status: "active", account } : { status: "signedOut" });
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

  async function onSubscribe() {
    setBusy(true);
    try {
      window.location.href = await startCheckout();
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
          <button type="button" class="account-button" onClick={onSubscribe} disabled={busy}>
            {t.account.subscribeButton}
          </button>
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
    </>
  );
}
