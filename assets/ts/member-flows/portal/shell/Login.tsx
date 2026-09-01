/**
 * Identity-based portal login screen — one magic link or passkey ceremony
 * establishes every currently eligible staff/member capacity.
 *
 * The screen is the whole page while nobody is signed in, so it carries its
 * own `.pk` root. Two details are load-bearing rather than cosmetic:
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
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { TextInput } from "../../../ui/TextControl";

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
    <div class="pk pk-container pk-section pk-cluster pk-cluster--center">
      <Panel class="content-width-sm">
        <PanelHeader title="PKI Consortium Portal" headingLevel={2} />
        <PanelBody class="pk-stack">
          {passkeysSupported && !magicLink.sent && (
            <>
              <Button
                block
                loading={passkeySubmitting}
                disabled={passkeySubmitting}
                onClick={() => {
                  void handlePasskeySignIn();
                }}
              >
                {passkeySubmitting ? "Waiting for passkey…" : "Sign in with a passkey"}
              </Button>
              <p class="pk-small pk-center">or</p>
            </>
          )}

          {/* The instruction only makes sense while the field is on screen;
              after the send it contradicted the confirmation below it. */}
          {!magicLink.sent && <p class="pk-muted">Enter your email to receive a sign-in link.</p>}
          {magicLink.sent ? (
            <Alert tone="ok" title="Check your email">
              If this address has portal access, you&apos;ll receive a sign-in link shortly.
            </Alert>
          ) : (
            <form
              class="pk-stack"
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              <Field label="Email" required>
                {(control) => (
                  <TextInput
                    {...control}
                    type="email"
                    name="email"
                    placeholder="you@example.com"
                    autocomplete="email"
                  />
                )}
              </Field>
              <MagicLinkSubmitButton submitting={magicLink.submitting} />
            </form>
          )}
          <SignInError error={magicLink.error} />
        </PanelBody>
      </Panel>
    </div>
  );
}
