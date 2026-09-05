/**
 * Identity-based portal login screen — one magic link or passkey ceremony
 * establishes every currently eligible staff/member capacity.
 *
 * The screen fills the space between the site's own header and footer, which
 * Hugo renders around the portal mount. Two panels: the brand panel says where
 * the reader has arrived, and the card signs them in.
 *
 * The passkey is the primary action and the email link folds away behind it.
 * That ordering is the security position stated as a layout: a passkey cannot
 * be phished or replayed, and a sign-in link sitting in a mailbox can be. The
 * email route stays one click away for anyone who has not enrolled one yet.
 *
 * Two details are load-bearing rather than cosmetic:
 *
 *   - The email control is a `Field`, which owns the `for`/`id` pair and the
 *     required annotation. It no longer carries a hand-written `id`; the
 *     end-to-end specs that located `#portal-inp-email` now ask for the
 *     control by its accessible name, which is what a reader has too.
 *   - The confirmation is an `Alert` rather than a green box opening with a
 *     bare "✓". A screen reader reads that character out as a character, and
 *     it was the only thing besides the color saying the send had worked;
 *     the sentence says it instead, inside the Alert's `role="status"`.
 */
import { useState } from "preact/hooks";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { postJson } from "../../../shared/api-client";
import { authenticateWithPasskey } from "../../../shared/passkey-authentication";
import { MagicLinkSubmitButton, SignInError } from "../../../components/MagicLinkFeedback";
import { useMagicLinkRequest } from "../../../hooks/useMagicLinkRequest";
import { emailFromSubmitEvent } from "../../../shared/form/helpers";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import { userAuthRequestSchema } from "../../../../shared/schemas/user-auth";
import { portalReturnPath } from "../hash-route";
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { TextInput } from "../../../ui/TextControl";
import { LoginBackdrop } from "./LoginBackdrop";
import "./Login.css";

async function requestMagicLink(email: string): Promise<void> {
  // The route the sign-in interrupted rides along, so the link the email
  // carries brings the reader back to it — a working group they came to
  // join — rather than to the portal's front page.
  const body = userAuthRequestSchema.parse({ email, returnPath: portalReturnPath(window.location.hash) });
  await postJson("/api/v1/auth/request-link", body, successResponseSchema);
  // Always show success to prevent email enumeration (as in the shared auth flow).
}

async function signInWithPasskey(): Promise<void> {
  await authenticateWithPasskey();
}

export function Login({ onSignedIn }: { onSignedIn: () => void | Promise<void> }) {
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const magicLink = useMagicLinkRequest("Something went wrong. Please try again.");
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  /*
   * A browser with no passkey support has no primary action to fold behind,
   * so the email form is the screen rather than a disclosure inside it.
   *
   * A sent link takes the form away. The design leaves it up beside the
   * confirmation, but a form that still invites a submit after "check your
   * inbox" contradicts it — and the third send inside a minute is refused by
   * the rate limiter, so the invitation is to an error. The passkey button
   * stays: giving up on the email and using a passkey is a real thing to do.
   */
  const emailShown = (emailOpen || !passkeysSupported) && !magicLink.sent;

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
    <div class="pk pk-login">
      <LoginBackdrop />
      <main class="pk-login__panel">
        <div class="pk-login__card-wrap">
          <div class="pk-login__card">
            <div class="pk-login__card-rule" aria-hidden="true" />
            <div class="pk-login__card-body pk-stack">
              <div class="pk-stack pk-stack--tight">
                <h1 class="pk-login__title">Sign in</h1>
                <p class="pk-small pk-muted">
                  Your passkey is the fastest and safest way in — nothing to remember, nothing to phish.
                </p>
              </div>

              {magicLink.sent && (
                <Alert tone="ok" title="Check your email">
                  If this address has portal access, you&apos;ll receive a sign-in link shortly.
                </Alert>
              )}

              {passkeysSupported && (
                <div class="pk-stack pk-stack--tight">
                  <Button
                    variant="primary"
                    size="lg"
                    block
                    loading={passkeySubmitting}
                    disabled={passkeySubmitting}
                    onClick={() => {
                      void handlePasskeySignIn();
                    }}
                  >
                    {passkeySubmitting ? "Waiting for passkey…" : "Sign in with a passkey"}
                  </Button>
                  <p class="pk-small pk-muted pk-login__note">Uses Touch ID, Windows Hello or your security key.</p>
                </div>
              )}

              {passkeysSupported && !emailShown && (
                <Button variant="secondary" size="lg" block onClick={() => setEmailOpen(true)}>
                  Sign in with an email link
                </Button>
              )}

              {emailShown && (
                <form
                  class="pk-stack pk-stack--tight"
                  onSubmit={(e) => {
                    void handleSubmit(e);
                  }}
                >
                  <Field label="Work email" required>
                    {(control) => (
                      <TextInput
                        {...control}
                        type="email"
                        name="email"
                        placeholder="you@organization.org"
                        autocomplete="email"
                      />
                    )}
                  </Field>
                  <MagicLinkSubmitButton submitting={magicLink.submitting} />
                  {passkeysSupported && (
                    <Button variant="ghost" size="sm" block onClick={() => setEmailOpen(false)}>
                      Back to passkey
                    </Button>
                  )}
                </form>
              )}

              <SignInError error={magicLink.error} />

              <p class="pk-small pk-muted pk-login__note">
                Trouble signing in? <a href="/about/contact/">Ask the secretariat</a>.
              </p>
            </div>
            <div class="pk-login__card-foot">
              <p class="pk-small pk-login__note">
                Not a member yet? <a href="/join/">Become a member</a> — participation is open to any organization
                working on PKI.
              </p>
            </div>
          </div>
          <p class="pk-small pk-muted pk-login__terms">
            By signing in you accept the <a href="/about/bylaws/">bylaws</a> and{" "}
            <a href="/about/privacy-policy/">privacy policy</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
