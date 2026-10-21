import type { AgendaSpeakerSession } from "./agenda-speaker-sessions";
import type { ClockZone } from "../../shared/event-clock";
import type { ContentAgendaSpeaker } from "../../shared/site-agenda";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { LinkList } from "../ui/LinkList";
import { Markdown } from "../ui/Markdown";
import "../../design/tokens.agenda.generated.css";
import "./ContentAgenda.css";
import "./AgendaSpeaker.css";
import { useContext } from "preact/hooks";
import { AgendaSpeakerDialogsContext, AgendaSpeakerProfile } from "./AgendaSpeakerProfile";
import { AgendaSpeakerDirectoryCard } from "./AgendaSpeakerDirectoryCard";
import { AgendaSpeakerAffiliations } from "./AgendaSpeakerAffiliations";

/** The same supplied speaker credit on agenda cards, details and static history pages. */
export function AgendaSpeaker({
  speaker,
  detail = false,
  directory = false,
  personPath,
  profileId,
  sessions,
  timeZone,
}: {
  speaker: ContentAgendaSpeaker;
  detail?: boolean;
  directory?: boolean;
  personPath?: string;
  profileId?: string;
  sessions?: readonly AgendaSpeakerSession[];
  timeZone?: ClockZone;
}) {
  const dialogs = useContext(AgendaSpeakerDialogsContext);
  const credit = <AgendaSpeakerCredit speaker={speaker} detail={detail} personPath={personPath} />;
  if (!profileId || personPath) return credit;
  // Inside an agenda the speaker's one profile dialog and preview are rendered beside the program.
  const sharedId = dialogs?.profileId(speaker);
  const id = sharedId ?? profileId;
  return (
    <div class="pk-agenda-speaker" data-agenda-speaker>
      {directory ? (
        <AgendaSpeakerDirectoryCard speaker={speaker} profileId={id} sessions={sessions} />
      ) : detail ? (
        <AgendaSpeakerCredit speaker={speaker} detail profileId={id} />
      ) : (
        <button
          type="button"
          class="pk-agenda-speaker__open"
          data-agenda-open-speaker
          aria-label={`View speaker profile: ${speaker.name}`}
          aria-haspopup="dialog"
          aria-controls={id}
        >
          <AgendaSpeakerCredit speaker={speaker} />
        </button>
      )}
      {sharedId ? null : (
        <AgendaSpeakerProfileParts speaker={speaker} profileId={id} sessions={sessions} timeZone={timeZone} />
      )}
    </div>
  );
}

/** A speaker's hover preview and profile dialog: once per speaker in an agenda, or beside a standalone credit. */
export function AgendaSpeakerProfileParts({
  speaker,
  profileId,
  sessions,
  timeZone,
}: {
  speaker: ContentAgendaSpeaker;
  profileId: string;
  sessions?: readonly AgendaSpeakerSession[];
  timeZone?: ClockZone;
}) {
  return (
    <>
      <span
        hidden
        data-person-card-profile={profileId}
        data-person-card={JSON.stringify({
          name: speaker.name,
          photoUrl: speaker.imageSrc,
          affiliation: speaker.affiliations?.[0],
          sessionRole: speaker.roleLabel,
          roles: [speaker.moderator ? "moderator" : "speaker"],
          profilePath: speaker.personPath,
        })}
      />
      <AgendaSpeakerProfile speaker={speaker} profileId={profileId} sessions={sessions} timeZone={timeZone} />
    </>
  );
}

/** One speaker credit: portrait, name, role, title, organization and, in detail, links and biography. */
export function AgendaSpeakerCredit({
  speaker,
  detail = false,
  personPath,
  profileId,
}: {
  speaker: ContentAgendaSpeaker;
  detail?: boolean;
  personPath?: string;
  profileId?: string;
}) {
  const name = personPath ? (
    <a href={personPath}>{speaker.name}</a>
  ) : profileId ? (
    <button
      type="button"
      class="pk-agenda-speaker__name"
      data-agenda-open-speaker
      aria-label={`View speaker profile: ${speaker.name}`}
      aria-haspopup="dialog"
      aria-controls={profileId}
    >
      {speaker.name}
    </button>
  ) : (
    speaker.name
  );
  return (
    <div class={`pk-content-agenda__speaker${detail ? " pk-content-agenda__speaker--detail" : ""}`}>
      {profileId ? (
        // The name is the speaker's one control; the portrait opens the same profile by pointer only.
        <button
          type="button"
          class="pk-agenda-speaker__portrait"
          data-agenda-open-speaker
          aria-controls={profileId}
          aria-hidden="true"
          tabIndex={-1}
        >
          <Avatar name={speaker.name} src={speaker.imageSrc} size="md" />
        </button>
      ) : (
        <Avatar name={speaker.name} src={speaker.imageSrc} size="md" />
      )}
      <div class="pk-content-agenda__speaker-info">
        <div>
          <span class="pk-content-agenda__speaker-name">
            {detail ? <h3>{name}</h3> : <strong>{name}</strong>}
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
            {detail && speaker.links?.length ? (
              <LinkList links={speaker.links} ownerName={speaker.name} label={`${speaker.name} elsewhere`} compact />
            ) : null}
          </span>
          {/* Only the profile has room for every affiliation; other rows show one at a time. */}
          <AgendaSpeakerAffiliations
            affiliations={speaker.affiliations}
            layout="rotating"
            size={detail ? "preview" : "card"}
            showLogos={detail}
          />
        </div>
        {detail && (speaker.bioMarkdown || speaker.bioHtml) ? (
          <div class="pk-content-agenda__speaker-bio">
            {speaker.bioMarkdown ? (
              <Markdown markdown={speaker.bioMarkdown} />
            ) : (
              <div dangerouslySetInnerHTML={{ __html: speaker.bioHtml! }} />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
