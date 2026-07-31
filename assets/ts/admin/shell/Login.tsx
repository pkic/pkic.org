import { useState } from "preact/hooks";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { saveAuth } from "../state";

async function requestMagicLink(email: string): Promise<void> {
  const res = await fetch("/api/v1/admin/auth/request-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  // request-link.ts always responds 200 regardless of whether the email
  // belongs to an admin, to prevent enumeration — so a non-ok response
  // here is a genuine failure (rate limited, validation, 5xx), not a
  // "does this admin exist" signal, and is safe to surface.
  if (!res.ok) {
    const body: { error?: { message?: string } } = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? "Could not send sign-in link. Please try again.");
  }
}

async function verifyMagicLink(token: string): Promise<void> {
  const res = await fetch("/api/v1/admin/auth/verify-link", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const d: { admin?: { email?: string }; error?: { message?: string } } = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(d.error?.message ?? "The link may have expired or already been used.");
  }
  saveAuth(d.admin?.email ?? null);
  history.replaceState({}, "", "/admin/");
}

/**
 * PRD §3.4 — usernameless passkey login. Mirrors verifyMagicLink's
 * saveAuth()/redirect handling so both login methods land in the same place.
 */
async function signInWithPasskey(): Promise<void> {
  const beginRes = await fetch("/api/v1/auth/passkeys/authenticate/begin");
  const begin: { options?: unknown; challengeToken?: string; error?: { message?: string } } = await beginRes
    .json()
    .catch(() => ({}));
  if (!beginRes.ok || !begin.options || !begin.challengeToken) {
    throw new Error(begin.error?.message ?? "Could not start passkey sign-in.");
  }

  const assertion = await startAuthentication({ optionsJSON: begin.options as PublicKeyCredentialRequestOptionsJSON });

  const completeRes = await fetch("/api/v1/auth/passkeys/authenticate/complete", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeToken: begin.challengeToken, response: assertion }),
  });
  const d: { admin?: { email?: string }; error?: { message?: string } } = await completeRes.json().catch(() => ({}));
  if (!completeRes.ok) {
    throw new Error(d.error?.message ?? "Passkey sign-in failed.");
  }
  saveAuth(d.admin?.email ?? null);
  history.replaceState({}, "", "/admin/");
}

export function Login() {
  const [sent, setSent] = useState(false);
  const [verifying, setVerifying] = useState(() => Boolean(new URLSearchParams(window.location.search).get("token")));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  async function handlePasskeySignIn(): Promise<void> {
    setError(null);
    setPasskeySubmitting(true);
    try {
      await signInWithPasskey();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPasskeySubmitting(false);
    }
  }

  if (verifying) {
    const tok = new URLSearchParams(window.location.search).get("token");
    if (tok) {
      verifyMagicLink(tok).catch((err: unknown) => {
        setError((err as Error).message);
        setVerifying(false);
      });
    }
    return (
      <div id="verify-overlay">
        <div class="spinner-border text-success" role="status"></div>
        <p class="text-muted mb-0">Verifying your sign-in link…</p>
      </div>
    );
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    if (!email) return;
    setError(null);
    setSubmitting(true);
    try {
      await requestMagicLink(email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div id="login-wrap">
      <div id="login-card">
        <h2>Admin Console</h2>
        {passkeysSupported && !sent && (
          <>
            <button
              id="btn-passkey"
              type="button"
              class="btn btn-outline-success w-100 mb-3"
              disabled={passkeySubmitting}
              onClick={() => {
                void handlePasskeySignIn();
              }}
            >
              {passkeySubmitting ? "Waiting for passkey…" : "Sign in with a passkey"}
            </button>
            <div class="text-center text-muted small mb-3">or</div>
          </>
        )}
        <p class="sub">Enter your admin email to receive a sign-in link.</p>
        {sent ? (
          <div id="magic-sent" class="alert alert-success mt-3">
            ✓ If this address is registered, you'll receive a sign-in link shortly.
          </div>
        ) : (
          <form
            id="form-magic"
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
          >
            <div class="mb-3">
              <label class="form-label fw-semibold" for="inp-email">
                Admin email
              </label>
              <input
                class="form-control"
                type="email"
                id="inp-email"
                name="email"
                placeholder="john.doe@example.com"
                required
                autocomplete="email"
              />
            </div>
            <button id="btn-send" type="submit" class="btn btn-success w-100" disabled={submitting}>
              {submitting ? "Sending…" : "Send sign-in link"}
            </button>
          </form>
        )}
        {error && <div class="alert alert-danger mt-3">✕ Sign-in failed: {error}</div>}
      </div>
    </div>
  );
}
