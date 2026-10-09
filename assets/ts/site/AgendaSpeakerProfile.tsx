import type { AgendaSpeakerSession } from "./agenda-speaker-sessions";
import { formatDateTime, formatDateTimeInZone } from "../../shared/format-date";
import { Badge } from "../ui/Badge";
import type { ComponentChildren } from "preact";
import type { ContentAgendaSpeaker } from "../../shared/site-agenda";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { DeferredImages } from "./SiteImage";

/** This profile presents the supplied credit; it never resolves a current account by name. */
export function AgendaSpeakerProfile({
  speaker,
  profileId,
  children,
  sessions,
  timeZone,
}: {
  speaker: ContentAgendaSpeaker;
  profileId: string;
  children: ComponentChildren;
  sessions?: readonly AgendaSpeakerSession[];
  timeZone?: string;
}) {
  return (
    <dialog
      class="pk-agenda-speaker-profile"
      id={profileId}
      aria-label={`Speaker profile: ${speaker.name}`}
      data-agenda-speaker-dialog
    >
      <DeferredImages>
        <Button icon variant="ghost" aria-label="Close speaker profile" data-agenda-close-speaker>
          ×
        </Button>
        <div class="pk-agenda-speaker-profile__portrait">
          <Avatar name={speaker.name} src={speaker.imageSrc} size="xl" original />
        </div>
        <div class="pk-agenda-speaker-profile__content">
          {children}
          {speaker.personPath ? <a href={speaker.personPath}>Full speaker profile</a> : null}
          {sessions?.length ? (
            <section class="pk-agenda-speaker-profile__sessions">
              <h3>Sessions</h3>
              <ul>
                {sessions.map((session) => (
                  <li key={session.id}>
                    <span>
                      <time dateTime={session.startsAt}>
                        {timeZone ? formatDateTimeInZone(session.startsAt, timeZone) : formatDateTime(session.startsAt)}
                      </time>
                      {session.room ? <small>{session.room}</small> : null}
                    </span>
                    <span>
                      {session.url ? <a href={session.url}>{session.title}</a> : session.title}
                      {session.moderator ? (
                        <Badge tone="warn" dot={false}>
                          Moderator
                        </Badge>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </DeferredImages>
    </dialog>
  );
}
