import { useEffect, useState } from "preact/hooks";
import {
  meetingInvitationVerificationCreateResponseSchema,
  meetingInvitationVerificationUpdateResponseSchema,
  meetingJoinLandingSchema,
  meetingJoinResponseSchema,
  type MeetingJoinLanding,
} from "../../../shared/schemas/event-series";
import { ApiClientError, getJson, patchJson, postJson } from "../../shared/api-client";
import type { MeetingGuestInvitationFragment } from "./invitation-fragment";
import { MeetingJoinForm } from "./MeetingJoinForm";

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
    setSubmitting(true);
    setError(null);
    try {
      await patchJson(
        `${verificationCollectionEndpoint(occurrenceId)}/${encodeURIComponent(verificationId)}`,
        { code: code.trim().toUpperCase() },
        meetingInvitationVerificationUpdateResponseSchema,
      );
      setLanding(await loadAuthenticatedLanding(occurrenceId));
      setVerificationId(null);
      setCode("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function join(acceptedTermIds: string[]): Promise<void> {
    if (!landing) return;
    setSubmitting(true);
    setError(null);
    try {
      const acceptedTerms = landing.terms
        .filter((term) => acceptedTermIds.includes(term.id) && !term.accepted)
        .map((term) => ({ termId: term.id, version: term.version }));
      const result = await postJson(
        `${occurrenceEndpoint(occurrenceId)}/join`,
        { landingRevision: landing.landingRevision, acceptedTerms, intentionalJoin: true },
        meetingJoinResponseSchema,
      );
      window.location.assign(result.redirectUrl);
    } catch (caught) {
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div class="text-muted py-5 text-center">Preparing secure meeting entry…</div>;
  }
  if (verificationId) {
    return (
      <div class="card shadow-sm">
        <div class="card-body p-4">
          <h1 class="h4">Verify your invitation</h1>
          <p>Enter the code sent to the invited email address in this same browser.</p>
          <label class="form-label fw-semibold" for="meeting-guest-code">
            Verification code
          </label>
          <input
            id="meeting-guest-code"
            class="form-control text-uppercase mb-3"
            autocomplete="one-time-code"
            inputMode="text"
            maxlength={8}
            value={code}
            onInput={(event) => setCode(event.currentTarget.value)}
          />
          {error && <div class="alert alert-danger">{error}</div>}
          <button
            class="btn btn-primary"
            type="button"
            disabled={submitting || code.trim().length !== 8}
            onClick={() => void verifyGuest()}
          >
            {submitting ? "Verifying…" : "Verify invitation"}
          </button>
        </div>
      </div>
    );
  }
  if (landing) {
    return <MeetingJoinForm landing={landing} submitting={submitting} error={error} onJoin={(ids) => void join(ids)} />;
  }
  return (
    <div class="alert alert-warning">
      {error ?? "Sign in through the member portal or open the invitation sent to the guest email address."}
    </div>
  );
}
