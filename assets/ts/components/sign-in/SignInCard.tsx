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
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { postJson } from "../../shared/api-client";
import { authenticateWithPasskey } from "../../shared/passkey-authentication";
import { MagicLinkSubmitButton, SignInError } from "../MagicLinkFeedback";
import { useMagicLinkRequest } from "../../hooks/useMagicLinkRequest";
import { useContractForm } from "../../hooks/useContractForm";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { userAuthRequestSchema, userSignUpRequestSchema } from "../../../shared/schemas/user-auth";
import { EmailFirstStep } from "../EmailFirstStep";
import type { SignInDestination, SignInDestinationDetail } from "./sign-in-destination";
import { signInDestination } from "./sign-in-destinations";
import { Alert } from "../../ui/Alert";
import { SectionHeading } from "../../ui/SectionHeading";
import { Button } from "../../ui/Button";
import { ExternalLink } from "../../ui/ExternalLink";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";
import { LoginFrame } from "./LoginFrame";
import { Spinner } from "../../ui/Spinner";
import type { PortalLoginCopy } from "../../../shared/schemas/portal-login-copy";
import type { EmailFirstFlow } from "../../../shared/email-first-copy";

async function requestMagicLink(body: ReturnType<typeof userAuthRequestSchema.parse>): Promise<void> {
  // The route the sign-in interrupted rides along, so the link the email
  // carries brings the reader back to it — a working group they came to
  // join — rather than to the portal's front page.
  await postJson("/api/v1/auth/request-link", body, successResponseSchema);
  // Always show success to prevent email enumeration (as in the shared auth flow).
}

async function signInWithPasskey(): Promise<void> {
  await authenticateWithPasskey();
}

export function SignInCard({
  onSignedIn,
  onAttempt,
  copy,
  busy = false,
  status,
  notice,
  returnPath: pageReturnPath,
  destination: pageDestination = null,
  embedded,
}: {
  onSignedIn: () => void | Promise<void>;
  onAttempt?: () => void;
  copy?: PortalLoginCopy;
  busy?: boolean;
  status?: string;
  notice?: ComponentChildren;
  /** Where a sign-in link returns the person on the screen that owns this card. */
  returnPath?: string;
  /** The flow that return path belongs to, when one describes itself. */
  destination?: SignInDestination | null;
  /**
   * A public flow's first step embeds this same card: where its links return
   * the person, and which wording the email step uses. The card words itself
   * for that flow; the page already shows the flow's progress.
   */
  embedded?: { returnPath: string; emailFlow: EmailFirstFlow };
}) {
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  // "New here?": the work-or-personal email step that starts an account, opened from the card's lower band.
  const [createOpen, setCreateOpen] = useState(false);
  const [individual, setIndividual] = useState(false);
  const [createSentTo, setCreateSentTo] = useState<string | null>(null);
  const returnPath = embedded ? embedded.returnPath : pageReturnPath;
  // The card says what the reader came to do: the flow sign-in returns them to describes itself, on its
  // public page as on its portal route.
  const destination = embedded ? signInDestination(embedded.returnPath) : pageDestination;
  // The flow's own progress and title load on demand; the plain sign-in card shows neither. They arrive as
  // state, so the card the page was pre-rendered with is updated in place. An embedding page already names
  // the flow and shows its progress, so it loads neither.
  const [detail, setDetail] = useState<SignInDestinationDetail>({});
  const loadDetail = embedded ? undefined : destination?.load;
  useEffect(() => {
    let current = true;
    setDetail({});
    if (loadDetail && returnPath)
      void loadDetail(returnPath).then((loaded) => {
        if (current) setDetail(loaded);
      });
    return () => {
      current = false;
    };
  }, [loadDetail, returnPath]);
  const progress = detail.Progress && <detail.Progress />;
  const form = useContractForm(userAuthRequestSchema, { email, returnPath });
  const magicLink = useMagicLinkRequest("Something went wrong. Please try again.");
  const passkeysSupported = typeof window !== "undefined" && browserSupportsWebAuthn();

  /*
   * A browser with no passkey support has no primary action to fold behind,
   * so the email form is the screen rather than a disclosure inside it.
   *
   * A sent link replaces the form with confirmation and an explicit way to
   * request another link. Returning to email preserves the address; choosing
   * a passkey clears the previous email feedback before its ceremony starts.
   */
  const emailShown = (emailOpen || !passkeysSupported) && !magicLink.sent;

  function openEmail(): void {
    onAttempt?.();
    magicLink.clearFeedback();
    setEmailOpen(true);
  }

  async function handleSubmit(e?: Event): Promise<void> {
    e?.preventDefault();
    if (busy || passkeySubmitting || magicLink.submitting) return;
    const checked = form.submit();
    if (!checked.data) return;
    onAttempt?.();
    await magicLink.request(async () => {
      try {
        await requestMagicLink(checked.data);
      } catch (error) {
        form.refuse(error);
        throw error;
      }
    });
  }

  async function handlePasskeySignIn(): Promise<void> {
    if (busy || passkeySubmitting || magicLink.submitting) return;
    onAttempt?.();
    magicLink.clearFeedback();
    setPasskeySubmitting(true);
    try {
      await signInWithPasskey();
      await onSignedIn();
    } catch (err) {
      magicLink.setError(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      setPasskeySubmitting(false);
    }
  }

  /** The email-link fields; `onSend` is given where no form of their own submits them. */
  const emailFields = (onSend?: () => void) => (
    <>
      <Field label="Email" required {...form.of("email")}>
        {(control) => (
          <TextInput
            {...control}
            type="email"
            name="email"
            value={email}
            onInput={(event) => setEmail(event.currentTarget.value)}
            placeholder="you@example.com"
            autocomplete="email"
            disabled={busy}
          />
        )}
      </Field>
      <p class="pk-small pk-muted">
        Use your account’s primary email or an address you enabled for sign-in. New speakers can use their invitation
        email.
      </p>
      <div class="pk-cluster">
        <MagicLinkSubmitButton submitting={magicLink.submitting} disabled={busy} onSend={onSend} />
        {passkeysSupported && (
          <Button
            variant="ghost"
            onClick={() => {
              magicLink.clearFeedback();
              setEmailOpen(false);
            }}
          >
            Back to passkey
          </Button>
        )}
      </div>
    </>
  );

  return (
    <LoginFrame
      label="Sign in"
      title={detail.title ?? destination?.title ?? (createOpen ? "Start with your email" : "Sign in")}
      lede={
        createOpen
          ? "We send a link to confirm the address is yours. Then you continue where you were going."
          : (destination?.lede ??
            "Your passkey is the fastest and safest way in — nothing to remember, nothing to phish.")
      }
      busy={busy}
      copy={copy}
      backdrop={!embedded}
      foot={
        createOpen || magicLink.sent ? undefined : (
          <div class="pk-login__controls pk-stack">
            <div class="pk-stack pk-stack--tight">
              <SectionHeading level={embedded ? 3 : 2} class="pk-login__start-title">
                New here?
              </SectionHeading>
              <p class="pk-small pk-muted">
                {destination?.startHint ?? "Start with your email. We confirm it is yours and you are in."}
              </p>
            </div>
            {progress}
            <Button
              variant="secondary"
              onClick={() => {
                onAttempt?.();
                magicLink.clearFeedback();
                setCreateOpen(true);
              }}
            >
              {destination?.startLabel ?? "Continue with your email"}
            </Button>
          </div>
        )
      }
      after={
        <p class="pk-small pk-muted pk-login__terms">
          By continuing you accept the{" "}
          <ExternalLink href="/bylaws/" external>
            bylaws
          </ExternalLink>{" "}
          and{" "}
          <ExternalLink href="/privacy/" external>
            privacy policy
          </ExternalLink>
          . Trouble signing in? <a href="mailto:contact@pkic.org">Ask the secretariat</a>.
        </p>
      }
    >
      {!magicLink.sent && !magicLink.error && notice}
      {status && <Spinner size="sm" label={status} />}
      {/* While the session check runs (`busy`) the sign-in actions stay disabled one by one, so the
          email disclosure still opens instead of swallowing the click. */}
      {createOpen && (
        <div class="pk-login__controls pk-stack">
          {progress}
          <EmailFirstStep
            flow={embedded?.emailFlow ?? destination?.emailFlow ?? "representation"}
            schema={userSignUpRequestSchema}
            body={{ returnPath }}
            email={email}
            onEmailChange={setEmail}
            individual={individual}
            onIndividualChange={setIndividual}
            onContinue={async (step) => {
              // The answer is the same whether or not the address has an account: a link is on its way.
              await postJson("/api/v1/auth/sign-up", step, successResponseSchema);
              setCreateSentTo(step.email);
            }}
            sentTo={createSentTo}
            onChangeEmail={() => setCreateSentTo(null)}
          />
          <Button
            variant="ghost"
            onClick={() => {
              setCreateSentTo(null);
              setCreateOpen(false);
            }}
          >
            Back to sign in
          </Button>
        </div>
      )}
      <fieldset
        class="pk-login__controls pk-stack"
        hidden={createOpen}
        disabled={passkeySubmitting || magicLink.submitting}
      >
        {magicLink.sent && (
          <Alert tone="ok" title="Check your email">
            If this address has portal access, you&apos;ll receive a sign-in link shortly.
          </Alert>
        )}

        {passkeysSupported && (
          <div class="pk-stack pk-stack--tight">
            <Button
              variant="primary"
              loading={passkeySubmitting}
              disabled={busy || passkeySubmitting}
              onClick={() => {
                void handlePasskeySignIn();
              }}
            >
              {passkeySubmitting ? "Waiting for passkey…" : "Sign in with a passkey"}
            </Button>
            <p class="pk-small pk-muted">Uses Touch ID, Windows Hello or your security key.</p>
          </div>
        )}

        {magicLink.sent && (
          <Button variant="secondary" onClick={openEmail}>
            Request another link
          </Button>
        )}

        {passkeysSupported && !emailShown && !magicLink.sent && (
          <Button variant="secondary" onClick={openEmail}>
            Sign in with an email link
          </Button>
        )}

        {emailShown &&
          (embedded ? (
            // The host page may be a form of its own, and a form cannot hold another: here the
            // fields stand in a plain group, and Enter or the button sends the link.
            <div
              role="group"
              aria-label="Sign in with an email link"
              class="pk-form"
              {...form.handlers}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
                void handleSubmit(event);
              }}
            >
              {emailFields(() => {
                void handleSubmit();
              })}
            </div>
          ) : (
            <form
              noValidate
              {...form.handlers}
              class="pk-form"
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              {emailFields()}
            </form>
          ))}
      </fieldset>

      <SignInError error={magicLink.error} waitHint={magicLink.waitHint} />
    </LoginFrame>
  );
}
