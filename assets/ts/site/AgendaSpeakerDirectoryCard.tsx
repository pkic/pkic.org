import type { ContentAgendaSpeaker } from "../../shared/site-agenda";
import { formatNumber } from "../../shared/format-number";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import type { AgendaSpeakerSession } from "./agenda-speaker-sessions";
import { AgendaSpeakerOrganization } from "./AgendaSpeakerOrganization";
import "../../design/tokens.agenda.generated.css";
import "./AgendaSpeakerDirectory.css";

/** The supplied frozen credit opens its existing profile; it never resolves identity by name. */
export function AgendaSpeakerDirectoryCard({
  speaker,
  profileId,
  sessions,
}: {
  speaker: ContentAgendaSpeaker;
  profileId: string;
  sessions?: readonly AgendaSpeakerSession[];
}) {
  return (
    <button
      type="button"
      class="pk-agenda-speaker-directory__card"
      data-agenda-open-speaker
      aria-label={`View speaker profile: ${speaker.name}`}
      aria-haspopup="dialog"
      aria-controls={profileId}
      aria-describedby={`${profileId}-preview`}
    >
      {/* The portrait fills its card, whose column is at least 230px wide (AgendaSpeakerDirectory.css). */}
      <Avatar name={speaker.name} src={speaker.imageSrc} size="xl" sizes="auto, 20rem" />
      <span class="pk-agenda-speaker-directory__caption">
        <strong>{speaker.name}</strong>
        {speaker.title ? <span class="pk-agenda-speaker-directory__title">{speaker.title}</span> : null}
        {speaker.moderator || speaker.roleLabel ? (
          <span class="pk-agenda-speaker-directory__roles">
            {speaker.moderator ? (
              <Badge tone="warn" dot={false}>
                Moderator
              </Badge>
            ) : null}
            {speaker.roleLabel ? (
              <Badge tone="neutral" dot={false}>
                {speaker.roleLabel}
              </Badge>
            ) : null}
          </span>
        ) : null}
        <span class="pk-agenda-speaker-directory__footer">
          <AgendaSpeakerOrganization organization={speaker.organization} size="card" />
          <span class="pk-agenda-speaker-directory__link">
            {sessions !== undefined ? (
              <span>
                {formatNumber(sessions.length)} {sessions.length === 1 ? "session" : "sessions"}
              </span>
            ) : null}
            <span>
              View profile <span aria-hidden="true">→</span>
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
