import { IconDownload, IconVideo } from "../ui/MediaIcons";
import { LinkList } from "../ui/LinkList";
import { Badge } from "../ui/Badge";
import { Avatar } from "../ui/Avatar";
import { Button, ButtonLink } from "../ui/Button";
import { formatTimeRangeInZone } from "../../shared/format-date";
import type { ContentAgendaDay, ContentAgendaLocation, ContentAgendaSpeaker } from "../../shared/site-agenda";

export function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5v4l2.5 1.5" />
    </svg>
  );
}

export function AgendaSpeaker({ speaker, detail = false }: { speaker: ContentAgendaSpeaker; detail?: boolean }) {
  return (
    <>
      <div class="pk-content-agenda__speaker">
        <Avatar name={speaker.name} src={speaker.imageSrc} size={detail ? "xl" : "md"} />
        <div>
          {detail ? <h3>{speaker.name}</h3> : <strong>{speaker.name}</strong>}
          {speaker.moderator ? (
            <Badge tone="warn" dot={false}>
              Moderator
            </Badge>
          ) : null}
          {speaker.title ? <small>{speaker.title}</small> : null}
          {detail && speaker.links?.length ? <LinkList links={speaker.links} ownerName={speaker.name} compact /> : null}
        </div>
      </div>
      {detail && speaker.bioHtml ? (
        <div class="pk-content-agenda__speaker-bio" dangerouslySetInnerHTML={{ __html: speaker.bioHtml }} />
      ) : null}
    </>
  );
}

export function AgendaSession({
  session,
  slot,
  locations,
  dialogId,
  timeZone,
}: {
  session: ContentAgendaDay["slots"][number]["sessions"][number];
  slot: ContentAgendaDay["slots"][number];
  locations: ContentAgendaLocation[];
  dialogId: string;
  timeZone: string;
}) {
  const locationIndex = Math.max(
    0,
    locations.findIndex((location) => location.id === session.locations[0]),
  );
  const roomNames = session.locations
    .map((id) => locations.find((location) => location.id === id)?.label)
    .filter(Boolean)
    .join(" / ");
  return (
    <article
      class={`pk-content-agenda__session pk-content-agenda__session--${locationIndex % 7}`}
      data-agenda-session={session.locations.join(" ")}
      data-agenda-session-dialog={dialogId}
    >
      <div class="pk-content-agenda__room">
        <span>{roomNames}</span>
        {session.track ? <span class="pk-content-agenda__track">{session.track}</span> : null}
      </div>
      <div class="pk-content-agenda__session-body">
        <h3 aria-label={session.title}>
          <button
            type="button"
            class="pk-content-agenda__title-action"
            data-agenda-open-session={dialogId}
            aria-label={`Open session details: ${session.title}`}
          >
            {session.title}
          </button>
        </h3>
        {session.speakers.map((speaker) => (
          <AgendaSpeaker speaker={speaker} key={speaker.name} />
        ))}
        {session.descriptionHtml ? (
          <div class="pk-content-agenda__description" dangerouslySetInnerHTML={{ __html: session.descriptionHtml }} />
        ) : null}
        {session.youtube || session.presentationUrl ? (
          <div class="pk-content-agenda__actions">
            {session.youtube ? (
              <button type="button" class="pk-content-agenda__media-action" data-agenda-open-session={dialogId}>
                <IconVideo /> Watch recording
              </button>
            ) : null}
            {session.presentationUrl ? (
              <a class="pk-content-agenda__media-action" href={session.presentationUrl} download>
                <IconDownload /> Download slides
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      {session.durationMinutes ? (
        <small class="pk-content-agenda__duration">
          <ClockIcon /> {session.durationMinutes} min
        </small>
      ) : null}
      <dialog class="session-modal" id={dialogId} aria-labelledby={`${dialogId}-title`}>
        <div class="session-modal__header">
          <div class="session-modal__heading pk-stack pk-stack--snug">
            <h2 class="session-modal__title" id={`${dialogId}-title`}>
              {session.title}
            </h2>
            <div class="pk-cluster pk-content-agenda__metadata">
              <span>
                <ClockIcon /> {formatTimeRangeInZone(slot.startsAt, session.endsAt, timeZone)}
              </span>
              {roomNames ? <span>{roomNames}</span> : null}
              {session.durationMinutes ? <span>{session.durationMinutes} min</span> : null}
            </div>
          </div>
          <Button variant="ghost" icon data-agenda-close-session aria-label="Close session details">
            ×
          </Button>
        </div>
        <div class="session-modal__body">
          {session.youtube && (
            <div class="session-modal__video">
              <iframe
                loading="lazy"
                data-video-src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(session.youtube)}`}
                title={session.title}
                allowFullScreen
              />
            </div>
          )}
          {session.descriptionHtml ? (
            <section class="pk-stack pk-stack--snug">
              <h3>Abstract</h3>
              <div dangerouslySetInnerHTML={{ __html: session.descriptionHtml }} />
            </section>
          ) : null}
          {session.speakers.length ? (
            <section class="pk-stack">
              <h3>Speakers</h3>
              {session.speakers.map((speaker) => (
                <article class="session-modal__speaker" key={speaker.name}>
                  <AgendaSpeaker speaker={speaker} detail />
                </article>
              ))}
            </section>
          ) : null}
        </div>
        <div class="session-modal__footer pk-cluster pk-cluster--end">
          {session.presentationUrl ? (
            <ButtonLink href={session.presentationUrl} variant="primary" download>
              Download Slides
            </ButtonLink>
          ) : null}
          <Button data-agenda-close-session>Close</Button>
        </div>
      </dialog>
    </article>
  );
}
