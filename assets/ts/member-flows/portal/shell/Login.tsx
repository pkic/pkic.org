/**
 * Identity-based portal login screen — one magic link or passkey ceremony
 * establishes every currently eligible staff/member capacity.
 */
import { useState } from "preact/hooks";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { postJson } from "../../../shared/api-client";
import { authenticateWithPasskey } from "../../../shared/passkey-authentication";
import { MagicLinkSubmitButton, SignInError } from "../../../components/MagicLinkFeedback";
import { useMagicLinkRequest } from "../../../hooks/useMagicLinkRequest";
import { emailFromSubmitEvent } from "../../../shared/form/helpers";
import { successResponseSchema } from "../../../../shared/schemas/api-common";

async function requestMagicLink(email: string): Promise<void> {
  await postJson("/api/v1/auth/request-link", { email }, successResponseSchema);
  // Always show success to prevent email enumeration (as in the shared auth flow).
}

async function signInWithPasskey(): Promise<void> {
  await authenticateWithPasskey();
}

export function Login({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const magicLink = useMagicLinkRequest("Something went wrong. Please try again.");
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  async function handleSubmit(e: Event): Promise<void> {
    const email = emailFromSubmitEvent(e);
    if (!email) return;
    await magicLink.request(() => requestMagicLink(email));
  }

  async function handlePasskeySignIn(): Promise<void> {
    magicLink.setError(null);
    setPasskeySubmitting(true);
    try {
      await signInWithPasskey();
      await onSignedIn();
    } catch (err) {
      magicLink.setError((err as Error).message);
    } finally {
      setPasskeySubmitting(false);
    }
  }

  return (
    <div class="d-flex justify-content-center py-4 py-md-5">
      <div class="card shadow-sm content-width-sm">
        <div class="card-body p-4">
          <h2 class="h4 mb-3">PKI Consortium Portal</h2>

          {passkeysSupported && !magicLink.sent && (
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
          {magicLink.sent ? (
            <div class="alert alert-success mt-3">
              ✓ If this address has portal access, you'll receive a sign-in link shortly.
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
              <MagicLinkSubmitButton submitting={magicLink.submitting} />
            </form>
          )}
          <SignInError error={magicLink.error} />
        </div>
      </div>
    </div>
  );
}
