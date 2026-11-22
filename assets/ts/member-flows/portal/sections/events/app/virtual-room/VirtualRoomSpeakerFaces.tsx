/**
 * The running session's people as small overlapping portraits at the end of its time line. Hovering,
 * focusing or tapping a portrait shows the person's card, so the line names no one and still says who is on.
 */
import { agendaSpeakerContent } from "../../../../../../../shared/public-agenda-content";
import { publicSessionCredits } from "../../../../../../../shared/session-public-credits";
import type { ContentAgendaSpeaker } from "../../../../../../../shared/site-agenda";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { formatNumber } from "../../../../../../../shared/format-number";
import { usePersonCard } from "../../../../../../site/PersonCard";
import { Avatar } from "../../../../../../ui/Avatar";
import type { RoomSession } from "./virtual-room-schedule";

/** The most portraits the line shows; the rest are counted. */
const FACES_SHOWN = 4;

function SpeakerFace({ speaker }: { speaker: ContentAgendaSpeaker }) {
  const role = speaker.roleLabel ?? (speaker.moderator ? "Moderator" : "Speaker");
  const card = usePersonCard<HTMLSpanElement>({
    person: {
      name: speaker.name,
      photoUrl: speaker.imageSrc,
      affiliation: speaker.affiliations?.[0] ?? null,
      sessionRole: `${role} in this session`,
    },
  });
  return (
    <span class="pk-virtual-room__face" ref={card.anchorRef} {...card.hoverProps}>
      <button type="button" class="pk-virtual-room__face-button" aria-label={speaker.name} {...card.toggleProps}>
        <Avatar name={speaker.name} src={speaker.imageSrc} size="sm" alt="" />
      </button>
      {card.card}
    </span>
  );
}

export function VirtualRoomSpeakerFaces({
  session,
  organizations,
}: {
  session: RoomSession;
  organizations?: AgendaSnapshot["speakerOrganizations"];
}) {
  const speakers = publicSessionCredits(session).map((credit) => agendaSpeakerContent(session, credit, organizations));
  if (!speakers.length) return null;
  const more = speakers.length - FACES_SHOWN;
  return (
    <span class="pk-virtual-room__faces" role="group" aria-label="Speakers">
      {speakers.slice(0, FACES_SHOWN).map((speaker, index) => (
        <SpeakerFace key={`${index}-${speaker.name}`} speaker={speaker} />
      ))}
      {more > 0 ? (
        <span class="pk-virtual-room__faces-more">
          <span aria-hidden="true">+{formatNumber(more)}</span>
          <span class="pk-sr-only">{more === 1 ? "and 1 more" : `and ${formatNumber(more)} more`}</span>
        </span>
      ) : null}
    </span>
  );
}
