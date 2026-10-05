import { httpOrSameOriginUrlSchema } from "../../shared/schemas/urls";
import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { IconDownload, IconVideo } from "../ui/MediaIcons";
import { LinkList } from "../ui/LinkList";
import { Badge } from "../ui/Badge";
import { Avatar } from "../ui/Avatar";
import { Button, ButtonLink } from "../ui/Button";
import { Markdown } from "../ui/Markdown";
import { formatTimeRangeInZone } from "../../shared/format-date";
import type {
  ContentAgendaDay,
  ContentAgendaLocation,
  ContentAgendaSpeaker,
  ContentAgendaSessionFragment,
} from "../../shared/site-agenda";

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
          {speaker.roleLabel ? (
            <Badge tone="neutral" dot={false}>
              {speaker.roleLabel}
            </Badge>
          ) : null}
          {speaker.title ? <small>{speaker.title}</small> : null}
          {detail && speaker.links?.length ? <LinkList links={speaker.links} ownerName={speaker.name} compact /> : null}
        </div>
      </div>
      {detail && speaker.bioMarkdown ? (
        <Markdown className="pk-content-agenda__speaker-bio" markdown={speaker.bioMarkdown} />
      ) : detail && speaker.bioHtml ? (
        <div class="pk-content-agenda__speaker-bio" dangerouslySetInnerHTML={{ __html: speaker.bioHtml }} />
      ) : null}
    </>
  );
}

export interface AgendaSessionEditor {
  resizeHandle?: ComponentChildren;
  controls: ComponentChildren;
  detailControls?: (close: () => void) => ComponentChildren;
  onDragStart?: JSX.DragEventHandler<HTMLElement>;
  onDragEnd?: JSX.DragEventHandler<HTMLElement>;
  onOpen?: () => void;
}

export function AgendaSession({
  session,
  slot,
  locations,
  dialogId,
  timeZone,
  editor,
  publicAnchor,
  legacyFragments = [],
}: {
  session: ContentAgendaDay["slots"][number]["sessions"][number];
  slot: ContentAgendaDay["slots"][number];
  locations: ContentAgendaLocation[];
  dialogId: string;
  publicAnchor?: string;
  legacyFragments?: readonly ContentAgendaSessionFragment[];
  timeZone: string;
  editor?: AgendaSessionEditor;
}) {
  const detail = useRef<HTMLDialogElement>(null);
  const recording = httpOrSameOriginUrlSchema.safeParse(session.recordingUrl);
  const recordingUrl = recording.success ? recording.data : undefined;
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
      id={publicAnchor}
      class={`pk-content-agenda__session pk-content-agenda__session--${locationIndex % 7}`}
      data-agenda-occurrence={session.id}
      draggable={Boolean(editor?.onDragStart)}
      onDragStart={editor?.onDragStart}
      onDragEnd={editor?.onDragEnd}
      data-agenda-session={session.locations.join(" ")}
      data-agenda-session-dialog={dialogId}
    >
      {legacyFragments.map((fragment) => (
        <span key={fragment.anchor} id={fragment.anchor} hidden data-agenda-fragment-dialog={dialogId} />
      ))}
      {editor?.controls}
      <div class="pk-content-agenda__room">
        <span>{roomNames}</span>
        {session.track ? <span class="pk-content-agenda__track">{session.track}</span> : null}
      </div>
      <div class="pk-content-agenda__session-body">
        <h3 aria-label={session.title}>
          <button
            type="button"
            class="pk-content-agenda__title-action"
            onClick={
              editor
                ? (event) => {
                    if (editor.onOpen) editor.onOpen();
                    else event.currentTarget.closest("article")?.querySelector("dialog")?.showModal();
                  }
                : undefined
            }
            data-agenda-open-session={dialogId}
            aria-label={`Open session details: ${session.title}`}
          >
            {session.title}
          </button>
        </h3>
        {session.speakers.map((speaker) => (
          <AgendaSpeaker speaker={speaker} key={speaker.name} />
        ))}
        {session.descriptionMarkdown !== undefined ? (
          <Markdown className="pk-content-agenda__description" markdown={session.descriptionMarkdown} />
        ) : session.descriptionHtml ? (
          <div class="pk-content-agenda__description" dangerouslySetInnerHTML={{ __html: session.descriptionHtml }} />
        ) : null}
      </div>
      {session.sessionUrl ||
      session.youtube ||
      recordingUrl ||
      session.presentationUrl ||
      (!editor && session.participation) ? (
        <div class="pk-content-agenda__actions">
          {!editor && session.participation && (
            <a
              class="pk-content-agenda__media-action"
              href={session.participation.url}
              title={session.participation.message}
            >
              {session.participation.label}
            </a>
          )}
          {session.sessionUrl && (
            <a class="pk-content-agenda__media-action" href={session.sessionUrl}>
              Session page
            </a>
          )}
          {session.youtube ? (
            <button type="button" class="pk-content-agenda__media-action" data-agenda-open-session={dialogId}>
              <IconVideo /> Watch recording
            </button>
          ) : null}
          {!session.youtube && recordingUrl && (
            <a class="pk-content-agenda__media-action" href={recordingUrl} target="_blank" rel="noopener noreferrer">
              <IconVideo /> Watch recording
            </a>
          )}
          {session.presentationUrl ? (
            <a
              class="pk-content-agenda__media-action"
              href={session.presentationUrl}
              data-legacy-download-url={session.legacyPresentationUrl}
              download
            >
              <IconDownload /> Download slides
            </a>
          ) : null}
        </div>
      ) : null}
      {editor?.resizeHandle}
      {session.endNotRecorded ? <p class="pk-muted">End not recorded</p> : null}
      {session.durationMinutes ? (
        <small class="pk-content-agenda__duration">
          <ClockIcon /> {session.durationMinutes} min
        </small>
      ) : null}
      <dialog ref={detail} class="session-modal" id={dialogId} aria-labelledby={`${dialogId}-title`}>
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
              {session.endNotRecorded ? (
                <span>End not recorded</span>
              ) : session.durationMinutes ? (
                <span>{session.durationMinutes} min</span>
              ) : null}
            </div>
          </div>
          {editor?.detailControls?.(() => detail.current?.close())}
          <Button
            variant="ghost"
            icon
            data-agenda-close-session
            onClick={editor ? (event) => event.currentTarget.closest("dialog")?.close() : undefined}
            aria-label="Close session details"
          >
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
          {session.descriptionMarkdown !== undefined || session.descriptionHtml ? (
            <section class="pk-stack pk-stack--snug">
              <h3>Abstract</h3>
              {session.descriptionMarkdown !== undefined ? (
                <Markdown markdown={session.descriptionMarkdown} />
              ) : (
                <div dangerouslySetInnerHTML={{ __html: session.descriptionHtml }} />
              )}
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
          {!editor && session.participation && (
            <ButtonLink href={session.participation.url} title={session.participation.message}>
              {session.participation.label}
            </ButtonLink>
          )}
          {recordingUrl && (
            <ButtonLink href={recordingUrl} target="_blank" rel="noopener noreferrer">
              Watch recording
            </ButtonLink>
          )}
          {session.presentationUrl ? (
            <ButtonLink
              href={session.presentationUrl}
              data-legacy-download-url={session.legacyPresentationUrl}
              variant="primary"
              download
            >
              Download Slides
            </ButtonLink>
          ) : null}
          <Button
            data-agenda-close-session
            onClick={editor ? (event) => event.currentTarget.closest("dialog")?.close() : undefined}
          >
            Close
          </Button>
        </div>
      </dialog>
    </article>
  );
}
