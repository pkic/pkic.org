/**
 * Member portal login screen — magic link + passkey (PRD §11 UI-1).
 * Mirrors admin/shell/Login.tsx's structure; the passkey ceremony code is
 * near-identical (a small duplicated helper, same precedent as ui.ts's
 * header comment) but posts to the member magic-link endpoints and expects
 * a `{member}` response from authenticate/complete rather than `{admin}` —
 * see functions/api/v1/auth/passkeys/authenticate-complete.ts's
 * kind-discriminated response, generalized in this same phase.
 */
import { useState } from "preact/hooks";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { postJson, ApiClientError } from "../../../shared/api-client";

async function requestMagicLink(email: string): Promise<void> {
  await postJson("/api/v1/auth/member/request-link", { email });
  // Always show success to prevent email enumeration (mirrors admin Login).
}

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
  const d: { member?: unknown; error?: { message?: string } } = await completeRes.json().catch(() => ({}));
  if (!completeRes.ok) {
    throw new Error(d.error?.message ?? "Passkey sign-in failed.");
  }
  if (!d.member) {
    // Succeeded, but the passkey belonged to a staff account, not a member.
    throw new Error("This passkey isn't registered to a member account.");
  }
}

export function Login({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

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
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasskeySignIn(): Promise<void> {
    setError(null);
    setPasskeySubmitting(true);
    try {
      await signInWithPasskey();
      await onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPasskeySubmitting(false);
    }
  }

  return (
    <div class="d-flex justify-content-center py-5">
      <div class="card shadow-sm" style="max-width: 420px; width: 100%;">
        <div class="card-body p-4">
          <h2 class="h4 mb-3">Member Portal</h2>

          {passkeysSupported && !sent && (
            <>
              <button
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

          <p class="text-muted">Enter your email to receive a sign-in link.</p>
          {sent ? (
            <div class="alert alert-success mt-3">
              ✓ If this address belongs to an active member, you'll receive a sign-in link shortly.
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              <div class="mb-3">
                <label class="form-label fw-semibold" for="portal-inp-email">
                  Email
                </label>
                <input
                  class="form-control"
                  type="email"
                  id="portal-inp-email"
                  name="email"
                  placeholder="you@example.com"
                  required
                  autocomplete="email"
                />
              </div>
              <button type="submit" class="btn btn-success w-100" disabled={submitting}>
                {submitting ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
          )}
          {error && <div class="alert alert-danger mt-3">✕ Sign-in failed: {error}</div>}
        </div>
      </div>
    </div>
  );
}
