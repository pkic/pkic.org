import type { ComponentChildren } from "preact";
import { SESSION_HELD_LABELS, type eventParticipationLink } from "../../shared/event-participation-link";
import { statusLabel, statusTone } from "../../shared/status-display";
import { Badge } from "../ui/Badge";
import { Button, ButtonLink } from "../ui/Button";
import { PreferenceStar } from "../ui/PreferenceStar";

type ParticipationLink = ReturnType<typeof eventParticipationLink>;

/** The signed-in viewer's own marks; supplied only by the portal's personal agenda. */
export interface AgendaPersonalSession {
  starred: boolean;
  status?: "reserved" | "approval_pending" | "waitlisted" | "canceled";
  busy?: boolean;
  onStar: () => void;
  /**
   * The seat action this viewer can take now, named by `sessionSeatAction` from their own admission;
   * absent when no seat can be taken. The card offers it and opens the details, which offer the same.
   */
  seatAction?: string;
  /**
   * Live participation actions after the abstract and speakers, present only when there is an action
   * or a standing to show; the portal wraps them in `SessionDetailsParticipation`.
   */
  detail?: ComponentChildren;
  /** Tools between the session details' star and close button, such as session check-in for scanner staff. */
  headerActions?: ComponentChildren;
}

/** A viewer's star on one session: whether it is set, and how to toggle it. */
export type SessionStarControl = Pick<AgendaPersonalSession, "starred" | "busy" | "onStar">;

/** A held seat, request or waiting place, in the shared participation vocabulary. */
export function SessionHeldBadge({ status }: { status: NonNullable<AgendaPersonalSession["status"]> }) {
  return (
    <Badge tone={statusTone(status)}>
      {status === "canceled" ? statusLabel(status) : SESSION_HELD_LABELS[status].status}
    </Badge>
  );
}

/** The session details' participation section, rendered only when it holds an action or a standing. */
export function SessionDetailsParticipation({ children }: { children: ComponentChildren }) {
  return (
    <section class="session-modal__participation pk-stack pk-stack--snug" aria-label="Participation">
      {children}
    </section>
  );
}

/** A signed-in viewer's star as an icon button, in the session details header and the dedicated session view. */
export function SessionStarButton({ title, star }: { title: string; star: SessionStarControl }) {
  return (
    <Button
      type="button"
      variant="ghost"
      icon
      aria-label={`Star ${title}`}
      aria-pressed={star.starred}
      title={sessionStarTitle(star.starred)}
      loading={star.busy}
      onClick={star.onStar}
    >
      <PreferenceStar selected={star.starred} />
    </Button>
  );
}

/** The public star's name and explanation, shared by the card and the session details header. */
function favoriteText(participation: ParticipationLink, title: string) {
  return {
    label: `${participation.favorite.label} for ${title}`,
    title: `${participation.favorite.label}. ${participation.favorite.message}`,
  };
}

/** The session details header star: live for a signed-in viewer, a link to sign in and save it otherwise. */
export function AgendaSessionStar({
  participation,
  title,
  personal,
}: {
  participation: ParticipationLink;
  title: string;
  personal?: AgendaPersonalSession;
}) {
  if (personal) return <SessionStarButton title={title} star={personal} />;
  const favorite = favoriteText(participation, title);
  return (
    <ButtonLink
      href={participation.favorite.url}
      variant="ghost"
      icon
      aria-label={favorite.label}
      title={favorite.title}
    >
      <PreferenceStar />
    </ButtonLink>
  );
}

/**
 * Interest and registration on an agenda card, and the public session details' registration link.
 * The session details header carries the admission line and the star; the portal's session details
 * render their own live action bar instead.
 */
export function AgendaParticipationControls({
  participation,
  title,
  detail = false,
  personal,
  dialogId,
}: {
  participation: ParticipationLink;
  title: string;
  detail?: boolean;
  personal?: AgendaPersonalSession;
  dialogId?: string;
}) {
  if (personal) return detail ? null : <PersonalCardControls {...{ participation, title, personal, dialogId }} />;
  // An open session has nothing to register for: its details show only the header star.
  if (detail)
    return participation.preference ? null : (
      <SessionDetailsParticipation>
        <div class="pk-cluster">
          <ButtonLink href={participation.url} variant="primary" title={participation.message}>
            {participation.label}
          </ButtonLink>
        </div>
      </SessionDetailsParticipation>
    );
  const favorite = favoriteText(participation, title);
  return (
    <>
      <a
        class="pk-content-agenda__media-action"
        href={participation.favorite.url}
        aria-label={favorite.label}
        title={favorite.title}
      >
        <PreferenceStar />
      </a>
      {!participation.preference && (
        <a class="pk-content-agenda__media-action" href={participation.url} title={participation.message}>
          {participation.label}
        </a>
      )}
    </>
  );
}

/** The portal acts in place on a card: the star adds it to My agenda; a seat is taken in the session details. */
function PersonalCardControls({
  participation,
  title,
  personal,
  dialogId,
}: {
  participation: ParticipationLink;
  title: string;
  personal: AgendaPersonalSession;
  dialogId?: string;
}) {
  return (
    <>
      {personal.status && <SessionHeldBadge status={personal.status} />}
      <button
        type="button"
        class="pk-content-agenda__media-action"
        aria-label={`Star ${title}`}
        aria-pressed={personal.starred}
        title={sessionStarTitle(personal.starred)}
        disabled={personal.busy}
        onClick={personal.onStar}
      >
        <PreferenceStar selected={personal.starred} />
      </button>
      {!personal.status && personal.seatAction && dialogId && (
        <button
          type="button"
          class="pk-content-agenda__media-action"
          data-agenda-open-session={dialogId}
          title={participation.message}
        >
          {personal.seatAction}
        </button>
      )}
    </>
  );
}

/** One explanation of the star wherever a signed-in viewer meets it. */
export function sessionStarTitle(starred: boolean) {
  return starred ? "On My agenda. Click to remove it." : "Star to add it to My agenda. A star does not reserve a seat.";
}

/** A canceled registration belongs to the personal agenda only while starred. */
export function isPersonalAgendaSession(marks: Pick<AgendaPersonalSession, "starred" | "status">): boolean {
  return marks.starred || Boolean(marks.status && marks.status !== "canceled");
}
