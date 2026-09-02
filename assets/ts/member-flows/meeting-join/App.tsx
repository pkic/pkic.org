import { useEffect, useState } from "preact/hooks";
import {
  meetingInvitationVerificationCreateResponseSchema,
  meetingInvitationVerificationUpdateResponseSchema,
  meetingInvitationVerificationUpdateSchema,
  meetingJoinLandingSchema,
  meetingJoinResponseSchema,
  type MeetingJoinLanding,
} from "../../../shared/schemas/meeting-entry";
import { Spinner } from "../../components/Spinner";
import { useContractForm } from "../../hooks/useContractForm";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody } from "../../ui/Panel";
import { TextInput } from "../../ui/TextControl";
import { ApiClientError, getJson, patchJson, postJson } from "../../shared/api-client";
import type { MeetingGuestInvitationFragment } from "./invitation-fragment";
import { MeetingJoinForm, type MeetingJoinConfirmInput } from "./MeetingJoinForm";

/** The length the verification endpoint accepts; nothing shorter is sent. */
const VERIFICATION_CODE_LENGTH = 8;

function occurrenceEndpoint(occurrenceId: string): string {
  return `/api/v1/meetings/occurrences/${encodeURIComponent(occurrenceId)}`;
}

function verificationCollectionEndpoint(occurrenceId: string): string {
  return `${occurrenceEndpoint(occurrenceId)}/invitations/verifications`;
}

async function loadAuthenticatedLanding(occurrenceId: string): Promise<MeetingJoinLanding> {
  return getJson(`${occurrenceEndpoint(occurrenceId)}/join`, meetingJoinLandingSchema);
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "Meeting entry is temporarily unavailable.";
}

export function App({ invitation }: { invitation: MeetingGuestInvitationFragment | null }) {
  const occurrenceId = invitation?.occurrenceId ?? new URLSearchParams(window.location.search).get("occurrence") ?? "";
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [landing, setLanding] = useState<MeetingJoinLanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The verification contract the route parses decides what the code field
  // shows and when the code may be sent.
  const verification = useContractForm(meetingInvitationVerificationUpdateSchema, { code });

  useEffect(() => {
    let cancelled = false;
    async function start(): Promise<void> {
      if (!occurrenceId) {
        setError("This meeting link is incomplete.");
        setLoading(false);
        return;
      }
      try {
        if (invitation) {
          const challenge = await postJson(
            verificationCollectionEndpoint(occurrenceId),
            { token: invitation.token },
            meetingInvitationVerificationCreateResponseSchema,
          );
          if (!cancelled) {
            setVerificationId(challenge.verificationId);
          }
        } else {
          const authenticated = await loadAuthenticatedLanding(occurrenceId);
          if (!cancelled) {
            setLanding(authenticated);
          }
        }
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, [invitation, occurrenceId]);

  async function verifyGuest(): Promise<void> {
    if (!verificationId) return;
    const checked = verification.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await patchJson(
        `${verificationCollectionEndpoint(occurrenceId)}/${encodeURIComponent(verificationId)}`,
        checked.data,
        meetingInvitationVerificationUpdateResponseSchema,
      );
      setLanding(await loadAuthenticatedLanding(occurrenceId));
      setVerificationId(null);
      setCode("");
      verification.reset();
    } catch (caught) {
      // A refusal that names the code lands on the field; anything else is
      // stated beside it, in the API's words when it has any.
      setError(caught instanceof ApiClientError ? verification.refuse(caught) : errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function join(input: MeetingJoinConfirmInput): Promise<void> {
    if (!landing) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await postJson(`${occurrenceEndpoint(occurrenceId)}/join`, input, meetingJoinResponseSchema);
      window.location.assign(result.redirectUrl);
    } catch (caught) {
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  if (loading) {
    // The wait is announced rather than mimed by grey text: Spinner carries
    // role="status" and names what is being prepared.
    return <Spinner label="Preparing secure meeting entry…" />;
  }
  if (verificationId) {
    return (
      <div class="pk">
        <Panel>
          <PanelBody class="pk-stack" {...verification.handlers}>
            <div class="pk-stack pk-stack--tight">
              <h1>Verify your invitation</h1>
              <p class="pk-muted">Enter the code sent to the invited email address in this same browser.</p>
            </div>
            {/* The contract's verdict on the code is the control's own, so it
                arrives as `aria-invalid` and `aria-describedby` on the input
                rather than as a red box somewhere near it. */}
            <Field
              label="Verification code"
              required
              help={`The code is ${String(VERIFICATION_CODE_LENGTH)} characters long.`}
              {...verification.of("code")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="code"
                  autocomplete="one-time-code"
                  inputMode="text"
                  maxlength={VERIFICATION_CODE_LENGTH}
                  value={code}
                  // Upper-cased as it is typed rather than by a text
                  // transform, so what the reader sees is what is sent.
                  onInput={(event) => setCode(event.currentTarget.value.toUpperCase())}
                />
              )}
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <div class="pk-cluster">
              <Button
                variant="primary"
                loading={submitting}
                disabled={submitting || !verification.valid}
                onClick={() => void verifyGuest()}
              >
                {submitting ? "Verifying…" : "Verify invitation"}
              </Button>
            </div>
          </PanelBody>
        </Panel>
      </div>
    );
  }
  if (landing) {
    return (
      <MeetingJoinForm landing={landing} submitting={submitting} error={error} onJoin={(input) => void join(input)} />
    );
  }
  return (
    <div class="pk">
      <Alert tone="warn">
        {error ?? "Sign in through the member portal or open the invitation sent to the guest email address."}
      </Alert>
    </div>
  );
}
