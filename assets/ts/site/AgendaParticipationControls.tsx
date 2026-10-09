import type { ComponentChildren } from "preact";
import type { eventParticipationLink } from "../../shared/event-participation-link";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button, ButtonLink } from "../ui/Button";
import { PreferenceStar } from "../ui/PreferenceStar";

/** The signed-in viewer's own marks; supplied only by the portal's personal agenda. */
export interface AgendaPersonalSession {
  starred: boolean;
  status?: "reserved" | "approval_pending" | "waitlisted";
  busy?: boolean;
  onStar: () => void;
  /** Live participation management shown below the session detail actions. */
  detail?: ComponentChildren;
}

const PERSONAL_STATUS: Record<NonNullable<AgendaPersonalSession["status"]>, { label: string; tone: BadgeTone }> = {
  reserved: { label: "Reserved", tone: "ok" },
  approval_pending: { label: "Awaiting approval", tone: "warn" },
  waitlisted: { label: "Waitlisted", tone: "info" },
};

/** Interest and registration stay independent on both cards and session details. */
export function AgendaParticipationControls({
  participation,
  title,
  detail = false,
  personal,
  dialogId,
}: {
  participation: ReturnType<typeof eventParticipationLink>;
  title: string;
  detail?: boolean;
  personal?: AgendaPersonalSession;
  dialogId?: string;
}) {
  if (personal) return <PersonalParticipationControls {...{ participation, title, detail, personal, dialogId }} />;
  const favoriteLabel = `${participation.favorite.label} for ${title}`;
  const favoriteTitle = `${participation.favorite.label}. ${participation.favorite.message}`;
  return (
    <>
      {(detail || !participation.preference) && (
        <Badge tone="neutral" dot={false}>
          {participation.policyLabel}
        </Badge>
      )}
      {detail ? (
        <ButtonLink href={participation.favorite.url} icon aria-label={favoriteLabel} title={favoriteTitle}>
          <PreferenceStar />
        </ButtonLink>
      ) : (
        <a
          class="pk-content-agenda__media-action"
          href={participation.favorite.url}
          aria-label={favoriteLabel}
          title={favoriteTitle}
        >
          <PreferenceStar />
        </a>
      )}
      {!participation.preference &&
        (detail ? (
          <ButtonLink href={participation.url} title={participation.message}>
            {participation.label}
          </ButtonLink>
        ) : (
          <a class="pk-content-agenda__media-action" href={participation.url} title={participation.message}>
            {participation.label}
          </a>
        ))}
    </>
  );
}

/** The portal acts in place: the star saves interest; registration opens the session details. */
function PersonalParticipationControls({
  participation,
  title,
  detail,
  personal,
  dialogId,
}: {
  participation: ReturnType<typeof eventParticipationLink>;
  title: string;
  detail: boolean;
  personal: AgendaPersonalSession;
  dialogId?: string;
}) {
  const status = personal.status ? PERSONAL_STATUS[personal.status] : undefined;
  const starLabel = `Star ${title}`;
  const starTitle = personal.starred
    ? "Starred. Click to remove it from My agenda."
    : "Star to add it to My agenda. A star does not reserve a place.";
  if (detail)
    return (
      <>
        <Badge tone="neutral" dot={false}>
          {participation.policyLabel}
        </Badge>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
        <Button
          icon
          aria-label={starLabel}
          aria-pressed={personal.starred}
          title={starTitle}
          loading={personal.busy}
          onClick={personal.onStar}
        >
          <PreferenceStar selected={personal.starred} />
        </Button>
      </>
    );
  return (
    <>
      {status && <Badge tone={status.tone}>{status.label}</Badge>}
      <button
        type="button"
        class="pk-content-agenda__media-action"
        aria-label={starLabel}
        aria-pressed={personal.starred}
        title={starTitle}
        disabled={personal.busy}
        onClick={personal.onStar}
      >
        <PreferenceStar selected={personal.starred} />
      </button>
      {!status && !participation.preference && dialogId && (
        <button
          type="button"
          class="pk-content-agenda__media-action"
          data-agenda-open-session={dialogId}
          title={participation.message}
        >
          {participation.label}
        </button>
      )}
    </>
  );
}
