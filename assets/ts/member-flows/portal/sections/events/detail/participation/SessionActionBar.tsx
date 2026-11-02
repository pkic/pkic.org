import { useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import type { personalAgendaSessionSchema } from "../../../../../../../shared/schemas/event-personal-agenda";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { PARTICIPATION_AVAILABILITY_LABELS } from "../../../../../../../shared/event-participation-availability";
import {
  SESSION_HELD_LABELS,
  SESSION_INVITED_LABEL,
  sessionSeatAction,
  eventVirtualRoomRoute,
} from "../../../../../../../shared/event-participation-link";
import { formatNumber } from "../../../../../../../shared/format-number";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { ApiClientError, putJson } from "../../../../../../shared/api-client";
import { Alert } from "../../../../../../ui/Alert";
import { Badge } from "../../../../../../ui/Badge";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { SessionHeldBadge } from "../../../../../../site/AgendaParticipationControls";
import { statusTone } from "../../../../../../../shared/status-display";
import { usePortalHashLocation } from "../../../../hash-location";
import { JoinSessionMeeting } from "./JoinSessionMeeting";

type Session = z.infer<typeof personalAgendaSessionSchema>;
type HeldStatus = keyof typeof SESSION_HELD_LABELS;

function heldStatus(status: Session["status"]): HeldStatus | null {
  return status === "reserved" || status === "approval_pending" || status === "waitlisted" ? status : null;
}

/** Why no seat can be taken right now, when the admission note alone does not say it. */
function unavailableReason(session: Session) {
  const availability = session.availability;
  if (session.admissionPolicy === "preference" || !availability || availability.bookingAction) return null;
  if (availability.state === "invitation_required") return null;
  return PARTICIPATION_AVAILABILITY_LABELS[availability.state];
}

/** Invited to an invitation-only session and not yet holding a seat there. */
function invitedStanding(session: Session) {
  return !heldStatus(session.status) && session.accessPolicy === "invitation" && session.invited;
}

/**
 * Whether the action bar has anything to show: an action, a standing, or a reason no seat can be
 * taken. An open session has none; its star and admission rule live with the session's heading.
 */
export function sessionHasParticipationActions(session: Session, notice?: string) {
  return Boolean(
    notice ||
    heldStatus(session.status) ||
    invitedStanding(session) ||
    sessionSeatAction(session) ||
    session.liveStreamRoomId ||
    session.onlineAccessAvailable ||
    unavailableReason(session) ||
    session.overlapCount > 0,
  );
}

/**
 * One participation action bar for a session: the single action that follows from its admission
 * rule and the person's standing. The session details and the dedicated session view both render
 * it, each beside its own star and admission line.
 */
export function SessionActionBar({
  slug,
  session,
  notice,
  onSaved,
}: {
  slug: string;
  session: Session;
  /** Shown above the actions, for example when the approved session changed while it was open. */
  notice?: string;
  onSaved: () => void;
}) {
  const held = heldStatus(session.status);
  const seat = held ? null : sessionSeatAction(session);
  // A confirmed seat elsewhere in the same time; reserving here swaps it only when the person agrees.
  const overlappingSeat = session.overlaps.find((other) => other.status === "reserved");
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refusedRevision, setRefusedRevision] = useState<number | null>(null);
  const reserve = useContractForm(sessionParticipationRequestSchema, {
    action: seat?.command ?? "reserve",
    expectedPublishedRevision: session.publishedRevision,
  });
  const swap = useContractForm(sessionParticipationRequestSchema, {
    action: "reserve",
    expectedPublishedRevision: session.publishedRevision,
    replaceOccurrenceId: overlappingSeat?.id,
  });
  const release = useContractForm(sessionParticipationRequestSchema, { action: "cancel" });
  useEffect(() => {
    if (refusedRevision === null || session.publishedRevision === refusedRevision) return;
    setRefusedRevision(null);
  }, [refusedRevision, session.publishedRevision]);
  const stale = refusedRevision === session.publishedRevision;

  async function takeSeat(event: Event) {
    event.preventDefault();
    if (!seat || running.current || stale) return;
    if (seat.command === "reserve" && !seat.full && overlappingSeat) {
      const swapping = await confirmAction({
        title: `This overlaps ${overlappingSeat.title}, where you have a seat. Swap your seat?`,
        body: `Your seat in ${overlappingSeat.title} is released only after your seat here is confirmed.`,
        confirmLabel: "Swap seat",
        cancelLabel: "Keep my current seat",
        tone: "primary",
      });
      if (!swapping) return;
      await apply(swap.submit(), swap.refuse);
      return;
    }
    await apply(reserve.submit(), reserve.refuse);
  }
  async function releaseSeat() {
    if (!held || running.current) return;
    const confirmed = await confirmAction({
      title: `${SESSION_HELD_LABELS[held].release.replace("…", "")} for ${session.title}?`,
      // Releasing a place keeps the star, so a starred session stays on the agenda.
      consequences: [
        `${
          held === "waitlisted"
            ? "You leave the waiting list"
            : held === "approval_pending"
              ? "Your request is withdrawn"
              : "Your seat is released"
        }; ${session.saved ? "the session stays on your agenda" : "the session leaves your agenda"}`,
        ...(held === "reserved" ? ["Your seat may go to the next person on the waiting list"] : []),
        "Taking a seat again depends on the availability at that time",
      ],
      confirmLabel: SESSION_HELD_LABELS[held].release.replace("…", ""),
      cancelLabel: "Keep it",
      tone: "danger",
    });
    if (!confirmed) return;
    await apply(release.submit(), release.refuse);
  }
  async function apply(checked: ReturnType<typeof reserve.submit>, refuse: typeof reserve.refuse) {
    if (running.current) return;
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await putJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(session.id)}/participation`,
        checked.data,
        sessionParticipationResponseSchema,
      );
      onSaved();
    } catch (error) {
      setError(refuse(error));
      if (error instanceof ApiClientError && error.status === 409 && error.code === "SESSION_PUBLICATION_CHANGED") {
        setRefusedRevision(session.publishedRevision);
        onSaved();
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  if (!sessionHasParticipationActions(session, notice) && !error) return null;
  const reason = held || seat ? null : unavailableReason(session);
  const invited = invitedStanding(session);
  return (
    <form class="pk-stack pk-stack--snug" noValidate {...reserve.handlers} onSubmit={takeSeat}>
      {notice && <Alert tone="warn">{notice}</Alert>}
      {(held || invited || seat || session.liveStreamRoomId || session.onlineAccessAvailable) && (
        <div class="pk-cluster">
          {held && <SessionHeldBadge status={held} />}
          {invited && <Badge tone={statusTone("invited")}>{SESSION_INVITED_LABEL}</Badge>}
          {seat && (
            <Button type="submit" variant="primary" loading={busy} disabled={stale}>
              {seat.label}
            </Button>
          )}
          {session.liveStreamRoomId && (
            <ButtonLink
              variant={seat ? "secondary" : "primary"}
              href={usePortalHashLocation.hrefs(
                eventVirtualRoomRoute(slug, { room: session.liveStreamRoomId, session: session.id }),
              )}
            >
              Join online
            </ButtonLink>
          )}
          {session.onlineAccessAvailable && (
            <JoinSessionMeeting
              slug={slug}
              sessionId={session.id}
              primary={!seat && !session.liveStreamRoomId}
              label={session.liveStreamRoomId ? "Join the meeting" : "Join online"}
            />
          )}
          {held && (
            <Button type="button" variant="danger-quiet" disabled={busy} onClick={() => void releaseSeat()}>
              {SESSION_HELD_LABELS[held].release}
            </Button>
          )}
        </div>
      )}
      {reason && <small class="pk-muted">{reason}</small>}
      {session.overlapCount > 0 && <OverlapNote session={session} />}
      {error && <ErrorAlert error={error} />}
    </form>
  );
}

/** One line about overlapping sessions on the person's agenda, with the sessions on request. */
function OverlapNote({ session }: { session: Session }) {
  const count = formatNumber(session.overlapCount);
  return (
    <details class="pk-muted">
      <summary>
        Overlaps {count} {session.overlapCount === 1 ? "session" : "sessions"} on your agenda
      </summary>
      <ul>
        {session.overlaps.map((other) => (
          <li key={other.id}>
            {other.title}
            {heldStatus(other.status) ? ` — ${SESSION_HELD_LABELS[heldStatus(other.status)!].status}` : ""}
          </li>
        ))}
      </ul>
      {session.overlapCount > session.overlaps.length && (
        <p>And {formatNumber(session.overlapCount - session.overlaps.length)} more.</p>
      )}
    </details>
  );
}
