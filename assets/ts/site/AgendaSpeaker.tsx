import type { AgendaSpeakerSession } from "./agenda-speaker-sessions";
import type { ContentAgendaSpeaker } from "../../shared/site-agenda";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { LinkList } from "../ui/LinkList";
import { Markdown } from "../ui/Markdown";
import "../../design/tokens.agenda.generated.css";
import "./ContentAgenda.css";
import "./AgendaSpeaker.css";
import { AgendaSpeakerProfile } from "./AgendaSpeakerProfile";
import { AgendaSpeakerDirectoryCard } from "./AgendaSpeakerDirectoryCard";
import { AgendaSpeakerOrganization } from "./AgendaSpeakerOrganization";
import { DeferredImages } from "./SiteImage";

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
  timeZone?: string;
}) {
  const credit = <SpeakerCredit speaker={speaker} detail={detail} personPath={personPath} />;
  if (!profileId || personPath) return credit;
  return (
    <div class="pk-agenda-speaker" data-agenda-speaker>
      {directory ? (
        <AgendaSpeakerDirectoryCard speaker={speaker} profileId={profileId} sessions={sessions} />
      ) : detail ? (
        <SpeakerCredit speaker={speaker} detail profileId={profileId} />
      ) : (
        <button
          type="button"
          class="pk-agenda-speaker__open"
          data-agenda-open-speaker
          aria-label={`View speaker profile: ${speaker.name}`}
          aria-haspopup="dialog"
          aria-controls={profileId}
          aria-describedby={`${profileId}-preview`}
        >
          <SpeakerCredit speaker={speaker} />
        </button>
      )}
      <div
        class="pk-agenda-speaker-preview"
        id={`${profileId}-preview`}
        data-agenda-speaker-preview
        popover="manual"
        role="tooltip"
        inert
      >
        <DeferredImages>
          <SpeakerCredit speaker={speaker} detail />
        </DeferredImages>
      </div>
      <AgendaSpeakerProfile speaker={speaker} profileId={profileId} sessions={sessions} timeZone={timeZone}>
        <SpeakerCredit speaker={speaker} detail organizationSize="profile" />
      </AgendaSpeakerProfile>
    </div>
  );
}

function SpeakerCredit({
  speaker,
  detail = false,
  personPath,
  profileId,
  organizationSize = "preview",
}: {
  speaker: ContentAgendaSpeaker;
  detail?: boolean;
  personPath?: string;
  profileId?: string;
  organizationSize?: "preview" | "profile";
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
      aria-describedby={`${profileId}-preview`}
    >
      {speaker.name}
    </button>
  ) : (
    speaker.name
  );
  return (
    <div class={`pk-content-agenda__speaker${detail ? " pk-content-agenda__speaker--detail" : ""}`}>
      {profileId ? (
        <button
          type="button"
          class="pk-agenda-speaker__portrait"
          data-agenda-open-speaker
          aria-label={`View speaker profile: ${speaker.name}`}
          aria-haspopup="dialog"
          aria-controls={profileId}
          aria-describedby={`${profileId}-preview`}
        >
          <Avatar name={speaker.name} src={speaker.imageSrc} size="md" />
        </button>
      ) : (
        <Avatar name={speaker.name} src={speaker.imageSrc} size="md" />
      )}
      <div class="pk-content-agenda__speaker-info">
        <div>
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
          {speaker.title ? <small>{speaker.title}</small> : null}
          {detail && speaker.links?.length ? <LinkList links={speaker.links} ownerName={speaker.name} compact /> : null}
        </div>
        {detail && speaker.organization ? (
          <div class="pk-content-agenda__speaker-organization">
            <AgendaSpeakerOrganization organization={speaker.organization} size={organizationSize} />
          </div>
        ) : null}
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
