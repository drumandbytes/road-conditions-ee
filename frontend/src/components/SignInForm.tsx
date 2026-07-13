import { useState } from "preact/hooks";
import { requestLogin } from "../lib/api";

export interface SignInFormT {
  toggleLink: string;
  backLink: string;
  emailPlaceholder: string;
  submitButton: string;
  sending: string;
  sentMessage: string;
  error: string;
}

interface SignInFormProps {
  t: SignInFormT;
}

// Lets an already-paying account authenticate a *second* device — the bearer_token itself is
// only ever shown once, right after checkout (see app.tsx), so without this a new device had
// no way to reuse an existing subscription short of asking for support.
export function SignInForm({ t }: SignInFormProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  if (!open) {
    return (
      <button type="button" class="account-link-button" onClick={() => setOpen(true)}>
        {t.toggleLink}
      </button>
    );
  }

  if (status === "sent") {
    return <p class="account-trial-note">{t.sentMessage}</p>;
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    try {
      // Resolves the same way whether or not the email matched an account (see
      // api-worker's handleRequestLogin) — nothing more specific to show either way.
      await requestLogin(email.trim());
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form class="sign-in-form" onSubmit={onSubmit}>
      {status === "error" && <p class="account-alert account-alert-error">{t.error}</p>}
      <input
        type="email"
        placeholder={t.emailPlaceholder}
        value={email}
        required
        onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
      />
      <div class="sign-in-form-actions">
        <button type="button" class="account-button account-button-secondary" onClick={() => setOpen(false)}>
          {t.backLink}
        </button>
        <button type="submit" class="account-button" disabled={status === "sending"}>
          {status === "sending" ? t.sending : t.submitButton}
        </button>
      </div>
    </form>
  );
}
