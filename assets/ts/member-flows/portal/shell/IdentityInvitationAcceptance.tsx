/** Public, explicit confirmation for a mailbox-bound identity invitation. */
import { useEffect, useState } from "preact/hooks";
import {
  identityInvitationLinkRequestSchema,
  identityInvitationPreviewResponseSchema,
  identityMutationResponseSchema,
} from "../../../../shared/schemas/identity";
import { ApiClientError, postJson } from "../../../shared/api-client";
import { Alert } from "../../../ui/Alert";
import { Button, ButtonLink } from "../../../ui/Button";
import { portalIdentityInvitationToken } from "../hash-route";
import { LoginBackdrop } from "./LoginBackdrop";
import "./Login.css";

type InvitationPreview = {
  organizationName: string;
  recipientEmail: string;
};

function invitationError(error: unknown): string {
  if (error instanceof ApiClientError && [404, 409, 410].includes(error.status)) {
    return "This invitation is expired, already accepted, or no longer available.";
  }
  return error instanceof ApiClientError ? error.message : "Could not review the identity invitation.";
}

export function IdentityInvitationAcceptance() {
  const token = portalIdentityInvitationToken(window.location.hash);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(token ? null : "This invitation link is incomplete.");
  const [loading, setLoading] = useState(Boolean(token));
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const parsed = identityInvitationLinkRequestSchema.safeParse({ token });
    if (!parsed.success) {
      setError("This invitation link is invalid.");
      setLoading(false);
      return;
    }
    postJson("/api/v1/identities/invitations/preview", parsed.data, identityInvitationPreviewResponseSchema)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(invitationError(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept(): Promise<void> {
    if (!token || !preview || accepting) return;
    setAccepting(true);
    setError(null);
    try {
      await postJson(
        "/api/v1/identities/invitations/accept",
        identityInvitationLinkRequestSchema.parse({ token }),
        identityMutationResponseSchema,
      );
      history.replaceState({}, "", "/portal/#/identity-invitations");
      setAccepted(true);
    } catch (reason) {
      setError(invitationError(reason));
    } finally {
      setAccepting(false);
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
              <h1 class="pk-login__title">Identity invitation</h1>
              {loading && <p>Checking your invitation…</p>}
              {error && (
                <Alert tone="danger" title="Cannot accept this invitation">
                  {error}
                </Alert>
              )}
              {preview && !accepted && (
                <div class="pk-stack pk-stack--snug">
                  <p>
                    Accept the invitation to act for <strong>{preview.organizationName}</strong> as{" "}
                    <strong>{preview.recipientEmail}</strong>?
                  </p>
                  <p class="pk-small pk-muted">
                    Actions taken in this capacity will be attributed to the organization. Opening the email link did
                    not activate it.
                  </p>
                  <Button
                    variant="primary"
                    block
                    loading={accepting}
                    disabled={accepting}
                    onClick={() => void accept()}
                  >
                    {accepting ? "Accepting…" : "Accept identity"}
                  </Button>
                </div>
              )}
              {accepted && (
                <Alert tone="ok" title="Identity accepted">
                  You can now act for {preview?.organizationName}. Sign in to the portal to use this capacity.
                </Alert>
              )}
              {!loading && (error || accepted) && (
                <ButtonLink href="/portal/#/account" variant="secondary" block>
                  Open portal
                </ButtonLink>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
