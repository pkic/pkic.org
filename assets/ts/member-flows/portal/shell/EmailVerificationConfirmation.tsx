/**
 * Public, explicit confirmation for an emailed address verification link.
 *
 * Like an identity invitation, the link alone proves the mailbox, so nobody
 * signs in first: the page names the address (read-only, so a mail scanner
 * opening the link verifies nothing) and verifies it on an explicit click.
 * A work address of a non-member organization joins it at once; a member
 * organization is offered, and only answering that offer needs a sign-in.
 */
import { useEffect, useState } from "preact/hooks";
import {
  ownEmailAddressVerificationPreviewResponseSchema,
  ownEmailAddressVerificationResponseSchema,
  ownEmailAddressVerificationSchema,
} from "../../../../shared/schemas/own-email-addresses";
import { ApiClientError, postJson } from "../../../shared/api-client";
import { Alert } from "../../../ui/Alert";
import { Button, ButtonLink } from "../../../ui/Button";
import { portalEmailVerificationToken } from "../hash-route";
import { LoginBackdrop } from "./LoginBackdrop";
import "./Login.css";

const ENDPOINT = "/api/v1/auth/email-verifications";
const ACCOUNT_HREF = "/portal/#/users/current";

type Verified = {
  email: string;
  joinedOrganization: { name: string } | null;
  offeredOrganization: { name: string } | null;
};

function linkError(error: unknown): string {
  if (error instanceof ApiClientError && [404, 409, 410].includes(error.status)) {
    return "This link has expired, was already used, or no longer matches an address on your account. Send a new link from your profile.";
  }
  return error instanceof ApiClientError ? error.message : "Could not check this verification link.";
}

export function EmailVerificationConfirmation() {
  const token = portalEmailVerificationToken(window.location.hash);
  const parsed = ownEmailAddressVerificationSchema.safeParse({ token });
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(parsed.success ? null : "This verification link is incomplete.");
  const [loading, setLoading] = useState(parsed.success);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<Verified | null>(null);

  useEffect(() => {
    if (!parsed.success) return;
    let cancelled = false;
    postJson(`${ENDPOINT}/preview`, parsed.data, ownEmailAddressVerificationPreviewResponseSchema)
      .then((preview) => {
        if (!cancelled) setEmail(preview.email);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(linkError(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function verify(): Promise<void> {
    if (!parsed.success || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await postJson(ENDPOINT, parsed.data, ownEmailAddressVerificationResponseSchema);
      // The link is spent; keep it out of the address bar and history.
      history.replaceState({}, "", "/portal/#/email-verifications");
      setVerified(result);
    } catch (reason) {
      setError(linkError(reason));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div class="pk pk-login">
      <LoginBackdrop />
      <section class="pk-login__panel" aria-label="Email verification">
        <div class="pk-login__card-wrap">
          <div class="pk-login__card">
            <div class="pk-login__card-rule" aria-hidden="true" />
            <div class="pk-login__card-body pk-stack">
              <h1 class="pk-login__title">Verify your email address</h1>
              {loading && <p>Checking your link…</p>}
              {error && (
                <Alert tone="danger" title="This address was not verified">
                  {error}
                </Alert>
              )}
              {email && !verified && (
                <div class="pk-stack pk-stack--snug">
                  <p>
                    Confirm that <strong>{email}</strong> is your address?
                  </p>
                  <p class="pk-small pk-muted">Opening the email link did not verify it.</p>
                  <Button variant="primary" loading={verifying} onClick={() => void verify()}>
                    {verifying ? "Verifying…" : "Verify this address"}
                  </Button>
                </div>
              )}
              {verified && (
                <Alert tone="ok" title={`${verified.email} is verified`}>
                  {verified.joinedOrganization
                    ? `You now represent ${verified.joinedOrganization.name} through this address.`
                    : verified.offeredOrganization
                      ? `This address belongs to ${verified.offeredOrganization.name}. Sign in to join it.`
                      : "You can now sign in with it."}
                </Alert>
              )}
              {!loading && (error || verified) && (
                <ButtonLink href={ACCOUNT_HREF} variant={verified?.offeredOrganization ? "primary" : "secondary"}>
                  {verified?.offeredOrganization
                    ? `Sign in to join ${verified.offeredOrganization.name}`
                    : "Open portal"}
                </ButtonLink>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
