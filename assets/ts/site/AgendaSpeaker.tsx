import type { ContentAgendaSpeaker } from "../../shared/site-agenda";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { LinkList } from "../ui/LinkList";
import { Markdown } from "../ui/Markdown";
import "../../design/tokens.agenda.generated.css";
import "./ContentAgenda.css";

/** The same supplied speaker credit on agenda cards, details and static history pages. */
export function AgendaSpeaker({
  speaker,
  detail = false,
  personPath,
}: {
  speaker: ContentAgendaSpeaker;
  detail?: boolean;
  personPath?: string;
}) {
  const name = personPath ? <a href={personPath}>{speaker.name}</a> : speaker.name;
  return (
    <div class={`pk-content-agenda__speaker${detail ? " pk-content-agenda__speaker--detail" : ""}`}>
      <Avatar name={speaker.name} src={speaker.imageSrc} size="md" />
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
