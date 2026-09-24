import { useEffect, useState } from "preact/hooks";
import { youtubeVideoEmbed } from "../../../shared/markdown-media";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import {
  meetingEntrySignInUrl,
  meetingSeriesEntrySignInUrl,
  personalMeetingEntrySignInUrl,
} from "../../../shared/meeting-entry-navigation";
import { BroadcastViewer } from "./BroadcastViewer";
import {
  meetingInvitationVerificationCreateResponseSchema,
  meetingInvitationVerificationUpdateResponseSchema,
  meetingInvitationVerificationUpdateSchema,
  meetingJoinLandingSchema,
  meetingJoinResponseSchema,
  meetingPersonalLinkResolveResponseSchema,
  meetingPersonalLinkSessionResponseSchema,
  PERSONAL_MEETING_LINK_HEADER,
  type MeetingJoinLanding,
} from "../../../shared/schemas/meeting-entry";
import { currentUserMeetingsListResponseSchema } from "../../../shared/schemas/member-meetings";
import { Spinner } from "../../components/Spinner";
import { useContractForm } from "../../hooks/useContractForm";
import { Alert } from "../../ui/Alert";
import { Button, ButtonLink } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Panel, PanelBody } from "../../ui/Panel";
import { TextInput } from "../../ui/TextControl";
import { ApiClientError, getJson, patchJson, postJson, requestJson } from "../../shared/api-client";
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

async function loadAuthenticatedLanding(
  occurrenceId: string,
  personalToken?: string | null,
): Promise<MeetingJoinLanding> {
  const path = `${occurrenceEndpoint(occurrenceId)}/join`;
  return personalToken
    ? requestJson(path, meetingJoinLandingSchema, {
        method: "GET",
        headers: { [PERSONAL_MEETING_LINK_HEADER]: personalToken },
      })
    : getJson(path, meetingJoinLandingSchema);
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "Meeting entry is temporarily unavailable.";
}

export function App({
  invitation,
  personalToken = null,
}: {
  invitation: MeetingGuestInvitationFragment | null;
  personalToken?: string | null;
}) {
  const query = new URLSearchParams(window.location.search);
  const requestedOccurrenceId = invitation?.occurrenceId ?? query.get("occurrence") ?? "";
  const seriesId = invitation ? "" : (query.get("series") ?? "");
  const [occurrenceId, setOccurrenceId] = useState(requestedOccurrenceId);
  const [broadcast, setBroadcast] = useState<{ embedUrl: string; destination: string } | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [landing, setLanding] = useState<MeetingJoinLanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personalName, setPersonalName] = useState<string | null>(null);
  // The verification contract the route parses decides what the code field
  // shows and when the code may be sent.
  const verification = useContractForm(meetingInvitationVerificationUpdateSchema, { code });

  useEffect(() => {
    let cancelled = false;
    async function start(): Promise<void> {
      if (!requestedOccurrenceId && !seriesId && !personalToken) {
        setError("This meeting link is incomplete.");
        setLoading(false);
        return;
      }
      try {
        let targetOccurrenceId = requestedOccurrenceId;
        if (personalToken) {
          const preview = await postJson(
            "/api/v1/meetings/links/resolve",
            { token: personalToken },
            meetingPersonalLinkResolveResponseSchema,
          );
          targetOccurrenceId = preview.occurrenceId;
          if (!cancelled) {
            setPersonalName(preview.name);
            setOccurrenceId(targetOccurrenceId);
          }
          const session = await postJson(
            `${occurrenceEndpoint(targetOccurrenceId)}/links/session`,
            { token: personalToken },
            meetingPersonalLinkSessionResponseSchema,
          );
          if (session.status === "ready") {
            const authenticated = await loadAuthenticatedLanding(targetOccurrenceId, personalToken);
            if (!cancelled) setLanding(authenticated);
          } else if (session.verification === "guest") {
            const challenge = await postJson(
              `${occurrenceEndpoint(targetOccurrenceId)}/links/verifications`,
              { token: personalToken },
              meetingInvitationVerificationCreateResponseSchema,
            );
            if (!cancelled) setVerificationId(challenge.verificationId);
          } else if (!cancelled) {
            setNeedsSignIn(true);
            setError("Verify your identity in the member portal once on this browser to continue.");
          }
          return;
        }
        if (!targetOccurrenceId) {
          const parameters = new URLSearchParams({ seriesId, limit: "1", offset: "0" });
          const page = await getJson(
            `/api/v1/users/current/meetings?${parameters.toString()}`,
            currentUserMeetingsListResponseSchema,
          );
          targetOccurrenceId = page.occurrences[0]?.occurrenceId ?? "";
          if (!targetOccurrenceId) {
            setError("No upcoming meeting in this series is available to join.");
            return;
          }
          if (!cancelled) setOccurrenceId(targetOccurrenceId);
        }
        if (invitation) {
          const challenge = await postJson(
            verificationCollectionEndpoint(targetOccurrenceId),
            { token: invitation.token },
            meetingInvitationVerificationCreateResponseSchema,
          );
          if (!cancelled) {
            setVerificationId(challenge.verificationId);
          }
        } else {
          const authenticated = await loadAuthenticatedLanding(targetOccurrenceId);
          if (!cancelled) {
            setLanding(authenticated);
          }
        }
      } catch (caught) {
        if (!cancelled) {
          setError(errorMessage(caught));
          setNeedsSignIn(caught instanceof ApiClientError && caught.status === 401);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, [invitation, personalToken, requestedOccurrenceId, seriesId]);

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
      if (personalToken) {
        const session = await postJson(
          `${occurrenceEndpoint(occurrenceId)}/links/session`,
          { token: personalToken },
          meetingPersonalLinkSessionResponseSchema,
        );
        if (session.status !== "ready") {
          throw new Error("Guest verification did not establish meeting access.");
        }
      }
      setLanding(await loadAuthenticatedLanding(occurrenceId, personalToken));
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
      const result = await postJson(
        `${occurrenceEndpoint(occurrenceId)}/join`,
        input,
        meetingJoinResponseSchema,
        personalToken ? { [PERSONAL_MEETING_LINK_HEADER]: personalToken } : undefined,
      );
      const embedUrl = youtubeVideoEmbed(result.redirectUrl);
      if (embedUrl) {
        setBroadcast({ embedUrl, destination: result.redirectUrl });
        setSubmitting(false);
      } else {
        window.location.assign(result.redirectUrl);
      }
    } catch (caught) {
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  async function switchIdentity(resumePersonalLink = false): Promise<void> {
    if (!occurrenceId) return;
    setSubmitting(true);
    setError(null);
    try {
      const forgotten = await fetch(`${occurrenceEndpoint(occurrenceId)}/links/session`, { method: "DELETE" });
      if (!forgotten.ok) throw new Error("The remembered meeting identity could not be cleared.");
      await postJson("/api/v1/auth/logout", {}, successResponseSchema);
      window.location.assign(
        resumePersonalLink && personalToken ? personalMeetingEntrySignInUrl(personalToken) : "/portal/",
      );
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
  if (landing && broadcast) return <BroadcastViewer landing={landing} {...broadcast} />;
  if (landing) {
    return (
      <MeetingJoinForm
        landing={landing}
        submitting={submitting}
        error={error}
        personal={Boolean(personalToken)}
        onSwitchIdentity={() => void switchIdentity()}
        onJoin={(input) => void join(input)}
      />
    );
  }
  return (
    <div class="pk">
      <Alert tone="warn">
        {personalName ? `Welcome, ${personalName}. ` : ""}
        {error ?? "Sign in through the member portal or open the invitation sent to the guest email address."}
      </Alert>
      {needsSignIn && (
        <p>
          {personalToken ? (
            <Button variant="primary" onClick={() => void switchIdentity(true)}>
              Verify and continue
            </Button>
          ) : (
            <ButtonLink
              variant="primary"
              href={seriesId ? meetingSeriesEntrySignInUrl(seriesId) : meetingEntrySignInUrl(occurrenceId)}
            >
              Sign in to continue
            </ButtonLink>
          )}
        </p>
      )}
      {personalToken && needsSignIn && (
        <p>
          <Button onClick={() => void switchIdentity()}>
            Not {personalName ?? "you"}? Sign in with another account
          </Button>
        </p>
      )}
    </div>
  );
}
