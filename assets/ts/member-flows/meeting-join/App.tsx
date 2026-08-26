import { useEffect, useState } from "preact/hooks";
import {
  meetingGuestInvitationBootstrapResponseSchema,
  meetingGuestInvitationVerifyResponseSchema,
  meetingJoinLandingSchema,
  meetingJoinResponseSchema,
  type MeetingJoinLanding,
} from "../../../shared/schemas/event-series";
import { ApiClientError, getJson, postJson } from "../../shared/api-client";
import type { MeetingGuestInvitationFragment } from "./invitation-fragment";
import { MeetingJoinForm } from "./MeetingJoinForm";

type JoinPersona = "member" | "guest";

function joinEndpoint(persona: JoinPersona, occurrenceId: string): string {
  const encoded = encodeURIComponent(occurrenceId);
  return persona === "member"
    ? `/api/v1/me/meetings/occurrences/${encoded}/join`
    : `/api/v1/meeting-guests/meetings/occurrences/${encoded}/join`;
}

async function loadAuthenticatedLanding(
  occurrenceId: string,
  guestOnly = false,
): Promise<{ landing: MeetingJoinLanding; persona: JoinPersona }> {
  if (!guestOnly) {
    try {
      return {
        landing: await getJson(joinEndpoint("member", occurrenceId), meetingJoinLandingSchema),
        persona: "member",
      };
    } catch (error) {
      if (!(error instanceof ApiClientError) || ![401, 403].includes(error.status)) throw error;
    }
  }
  return {
    landing: await getJson(joinEndpoint("guest", occurrenceId), meetingJoinLandingSchema),
    persona: "guest",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "Meeting entry is temporarily unavailable.";
}

export function App({ invitation }: { invitation: MeetingGuestInvitationFragment | null }) {
  const occurrenceId = invitation?.occurrenceId ?? new URLSearchParams(window.location.search).get("occurrence") ?? "";
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [landing, setLanding] = useState<MeetingJoinLanding | null>(null);
  const [persona, setPersona] = useState<JoinPersona | null>(null);
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
            "/api/v1/meeting-guests/invitations/bootstrap",
            { token: invitation.token, occurrenceId },
            meetingGuestInvitationBootstrapResponseSchema,
          );
          if (!cancelled) {
            setChallengeId(challenge.challengeId);
          }
        } else {
          const authenticated = await loadAuthenticatedLanding(occurrenceId);
          if (!cancelled) {
            setLanding(authenticated.landing);
            setPersona(authenticated.persona);
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
    if (!challengeId) return;
    setSubmitting(true);
    setError(null);
    try {
      await postJson(
        "/api/v1/meeting-guests/invitations/verify",
        { challengeId, code: code.trim().toUpperCase() },
        meetingGuestInvitationVerifyResponseSchema,
      );
      const authenticated = await loadAuthenticatedLanding(occurrenceId, true);
      setLanding(authenticated.landing);
      setPersona("guest");
      setChallengeId(null);
      setCode("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function join(acceptedTermIds: string[]): Promise<void> {
    if (!landing || !persona) return;
    setSubmitting(true);
    setError(null);
    try {
      const acceptedTerms = landing.terms
        .filter((term) => acceptedTermIds.includes(term.id) && !term.accepted)
        .map((term) => ({ termId: term.id, version: term.version }));
      const result = await postJson(
        joinEndpoint(persona, occurrenceId),
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
  if (challengeId) {
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
