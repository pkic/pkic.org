import { AgendaBreakSponsors } from "./AgendaBreakSponsors";
import { AgendaSpeaker } from "./AgendaSpeaker";
import { resolveAgendaDurationRules } from "../../shared/event-agenda-duration";
import { formatNumber } from "../../shared/format-number";
import { Menu } from "../ui/Menu";
import { httpOrSameOriginUrlSchema } from "../../shared/schemas/urls";
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { youtubeVideoEmbed } from "../../shared/markdown-media";
import { sameOriginPathSchema } from "../../shared/schemas/urls";
import { initializeAgendaSessionMedia, pauseAgendaSessionMedia } from "./agenda-session-media";
import { parseSessionRecordingPublicUrl } from "../../shared/session-recording-public-url";
import { IconBadge } from "../ui/Badge";
import { IconDownload, IconRemote, IconVideo } from "../ui/MediaIcons";
import { AgendaParticipationControls } from "./AgendaParticipationControls";
import { Button, ButtonLink } from "../ui/Button";
import { Markdown } from "../ui/Markdown";
import { formatTimeRangeInZone } from "../../shared/format-date";
import type { ContentAgendaDay, ContentAgendaLocation, ContentAgendaSessionFragment } from "../../shared/site-agenda";

export function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5v4l2.5 1.5" />
    </svg>
  );
}

export interface AgendaSessionEditor {
  onDurationChange?: (minutes: number) => void;
  durationDisabled?: boolean;
  durationOptions?: readonly number[];
  resizeHandle?: ComponentChildren;
  moveControls?: ComponentChildren;
  onRoomChange?: () => void;
  controls: ComponentChildren;
  detailControls?: (close: () => void) => ComponentChildren;
  onDragStart?: JSX.DragEventHandler<HTMLElement>;
  onDragEnd?: JSX.DragEventHandler<HTMLElement>;
  onOpen?: () => void;
}

function AgendaSessionDuration({
  session,
  editor,
}: {
  session: ContentAgendaDay["slots"][number]["sessions"][number];
  editor?: AgendaSessionEditor;
}) {
  if (!session.durationMinutes) return null;
  return (
    <small
      class="pk-content-agenda__duration"
      data-agenda-card-control
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {editor?.onDurationChange ? (
        <Menu
          label={`Duration for ${session.title}`}
          variant="plain"
          items={(editor.durationOptions ?? resolveAgendaDurationRules(undefined).quickMinutes).map((minutes) => ({
            id: String(minutes),
            label: `${formatNumber(minutes)} minutes`,
            checked: session.durationMinutes === minutes,
            disabled: editor.durationDisabled,
            onSelect: () => editor.onDurationChange?.(minutes),
          }))}
        >
          <ClockIcon />
          <span>{formatNumber(session.durationMinutes)} min</span>
        </Menu>
      ) : (
        <>
          <ClockIcon />
          <span>{formatNumber(session.durationMinutes)} min</span>
        </>
      )}
    </small>
  );
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
  slot?: Pick<ContentAgendaDay["slots"][number], "startsAt">;
  locations: ContentAgendaLocation[];
  dialogId: string;
  publicAnchor?: string;
  legacyFragments?: readonly ContentAgendaSessionFragment[];
  timeZone: string;
  editor?: AgendaSessionEditor;
}) {
  const detail = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLElement>(null);
  const recording = httpOrSameOriginUrlSchema.safeParse(session.recordingUrl);
  const recordingUrl = recording.success ? recording.data : undefined;
  const onlineAccess = sameOriginPathSchema.safeParse(session.onlineAccessUrl);
  const onlineAccessUrl = onlineAccess.success ? onlineAccess.data : undefined;
  const approvedEmbed = recordingUrl && session.recordingApproved ? youtubeVideoEmbed(recordingUrl) : null;
  const ownedRecording =
    recordingUrl && session.recordingApproved && parseSessionRecordingPublicUrl(recordingUrl) ? recordingUrl : null;
  const recordingEmbed = ownedRecording
    ? null
    : session.youtube
      ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(session.youtube)}`
      : approvedEmbed?.replace("https://www.youtube.com/embed/", "https://www.youtube-nocookie.com/embed/");
  const hasDetails = Boolean(
    editor ||
    session.sessionUrl ||
    session.speakers.length ||
    (session.descriptionMarkdown !== undefined ? session.descriptionMarkdown.trim() : session.descriptionHtml.trim()) ||
    recordingUrl ||
    recordingEmbed ||
    session.presentationUrl ||
    session.participation ||
    onlineAccessUrl,
  );
  const retainDialog = hasDetails || legacyFragments.length > 0;
  const hasMedia = Boolean(
    session.plannedMedia?.recording ||
    session.plannedMedia?.liveStreaming ||
    onlineAccessUrl ||
    recordingUrl ||
    recordingEmbed,
  );
  useEffect(() => {
    if (hasMedia && card.current && !card.current.closest(".pk-content-agenda"))
      return initializeAgendaSessionMedia(card.current);
  }, [
    hasMedia,
    slot?.startsAt,
    session.endsAt,
    session.onlineAccessUrl,
    session.recordingUrl,
    session.plannedMedia,
    session.youtube,
  ]);
  const openDetails = () => {
    const iframe = detail.current?.querySelector<HTMLIFrameElement>("iframe[data-video-src]");
    if (iframe && !iframe.closest("[hidden]")) iframe.src = iframe.dataset.videoSrc!;
    if (!detail.current?.open) detail.current?.showModal();
  };
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
      ref={card}
      id={publicAnchor}
      class={`pk-content-agenda__session pk-content-agenda__session--${locationIndex % 7}${session.kind === "break" ? " pk-content-agenda__session--break" : ""}`}
      data-agenda-occurrence={session.id}
      data-agenda-media-session={hasMedia ? "" : undefined}
      data-agenda-media-start={slot?.startsAt}
      data-agenda-media-end={session.endsAt}
      draggable={Boolean(editor?.onDragStart)}
      onDragStart={editor?.onDragStart}
      onDragEnd={editor?.onDragEnd}
      onClick={
        editor
          ? (event) => {
              const target = event.target;
              if (
                !(target instanceof Element) ||
                target.closest(
                  "a, button, input, select, textarea, label, summary, dialog, [data-agenda-card-control]",
                ) ||
                window.getSelection()?.toString()
              )
                return;
              if (editor.onOpen) editor.onOpen();
              else openDetails();
            }
          : undefined
      }
      data-agenda-session={(session.kind === "break" && session.locations.length === 0
        ? locations.map((location) => location.id)
        : session.locations
      ).join(" ")}
      data-agenda-session-dialog={hasDetails ? dialogId : undefined}
    >
      {legacyFragments.map((fragment) => (
        <span key={fragment.anchor} id={fragment.anchor} hidden data-agenda-fragment-dialog={dialogId} />
      ))}
      {editor?.controls ? (
        <div
          class="pk-content-agenda__card-header"
          data-agenda-card-control
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {editor.controls}
        </div>
      ) : null}
      {!editor ? (
        <div class="pk-content-agenda__room">
          <span>{roomNames}</span>
          {session.track ? <span class="pk-content-agenda__track">{session.track}</span> : null}
        </div>
      ) : null}
      <div class="pk-content-agenda__session-body">
        <h3 aria-label={session.title}>
          {!hasDetails ? (
            session.title
          ) : !editor && session.sessionUrl ? (
            <a
              class="pk-content-agenda__title-action"
              href={session.sessionUrl}
              data-agenda-open-session={dialogId}
              aria-label={`Open session details: ${session.title}`}
            >
              {session.title}
            </a>
          ) : (
            <button
              type="button"
              class="pk-content-agenda__title-action"
              onClick={
                editor
                  ? () => {
                      if (editor.onOpen) editor.onOpen();
                      else openDetails();
                    }
                  : undefined
              }
              data-agenda-open-session={dialogId}
              aria-label={`Open session details: ${session.title}`}
            >
              {session.title}
            </button>
          )}
        </h3>
        {session.kind === "break" && session.sponsors?.length ? (
          <AgendaBreakSponsors sponsors={session.sponsors} />
        ) : null}
        {session.speakers.map((speaker) => (
          <AgendaSpeaker speaker={speaker} key={speaker.name} />
        ))}
        {session.descriptionMarkdown?.trim() ? (
          <Markdown className="pk-content-agenda__description" markdown={session.descriptionMarkdown} />
        ) : session.descriptionMarkdown === undefined && session.descriptionHtml ? (
          <div class="pk-content-agenda__description" dangerouslySetInnerHTML={{ __html: session.descriptionHtml }} />
        ) : null}
      </div>
      {(session.plannedMedia?.recording || session.plannedMedia?.liveStreaming) && (
        <div class="pk-cluster" data-agenda-media-plans>
          {session.plannedMedia.recording && (
            <span data-agenda-media-before>
              <IconBadge icon={<IconVideo />} label="Recording planned" />
            </span>
          )}
          {session.plannedMedia.liveStreaming && (
            <span data-agenda-media-live-plan>
              <IconBadge icon={<IconRemote />} label="Live streaming planned" />
            </span>
          )}
        </div>
      )}
      <div
        class="pk-content-agenda__card-footer"
        data-agenda-card-control
        onPointerDown={editor ? (event) => event.stopPropagation() : undefined}
        onClick={editor ? (event) => event.stopPropagation() : undefined}
      >
        {session.youtube ||
        recordingUrl ||
        session.presentationUrl ||
        onlineAccessUrl ||
        (!editor && session.participation) ? (
          <div class="pk-content-agenda__actions">
            {!editor && session.participation && (
              <AgendaParticipationControls participation={session.participation} title={session.title} />
            )}
            {onlineAccessUrl && (
              <a
                class="pk-content-agenda__media-action"
                href={onlineAccessUrl}
                aria-label="Join online"
                title="Join online"
                data-agenda-media-during
                hidden
              >
                <IconRemote />
                <span class="pk-sr-only">Join online</span>
              </a>
            )}
            {recordingEmbed || ownedRecording ? (
              <a
                href={recordingUrl ?? `https://www.youtube.com/watch?v=${encodeURIComponent(session.youtube ?? "")}`}
                class="pk-content-agenda__media-action"
                data-agenda-open-session={dialogId}
                aria-label="Watch recording"
                title="Watch recording"
                data-agenda-watch-recording
                data-agenda-media-recording
                onClick={
                  editor
                    ? (event) => {
                        event.preventDefault();
                        openDetails();
                      }
                    : undefined
                }
              >
                <IconVideo />
                <span class="pk-sr-only">Watch recording</span>
              </a>
            ) : null}
            {!recordingEmbed && !ownedRecording && recordingUrl && (
              <a
                class="pk-content-agenda__media-action"
                href={recordingUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Watch recording"
                title="Watch recording"
                data-agenda-media-recording={session.recordingApproved ? "" : undefined}
              >
                <IconVideo />
                <span class="pk-sr-only">Watch recording</span>
              </a>
            )}
            {session.presentationUrl ? (
              <a
                class="pk-content-agenda__media-action"
                href={session.presentationUrl}
                data-legacy-download-url={session.legacyPresentationUrl}
                aria-label="Download slides"
                title="Download slides"
                download
              >
                <IconDownload />
                <span class="pk-sr-only">Download slides</span>
              </a>
            ) : null}
          </div>
        ) : null}
        <AgendaSessionDuration session={session} editor={editor} />
        {editor?.moveControls ? <div class="pk-content-agenda__move-controls">{editor.moveControls}</div> : null}
      </div>
      {editor?.resizeHandle}
      {session.endNotRecorded ? <p class="pk-content-agenda__unknown-end">End not recorded</p> : null}
      {retainDialog && (
        <dialog
          ref={detail}
          class={`session-modal${hasDetails ? "" : " session-modal--summary"}`}
          id={dialogId}
          aria-labelledby={`${dialogId}-title`}
          onClose={editor ? (event) => pauseAgendaSessionMedia(event.currentTarget) : undefined}
        >
          <div class="session-modal__header">
            <div class="session-modal__heading pk-stack pk-stack--snug">
              <h2 class="session-modal__title" id={`${dialogId}-title`}>
                {session.title}
              </h2>
              <div class="pk-cluster pk-content-agenda__metadata">
                <span>
                  <ClockIcon />{" "}
                  {slot ? formatTimeRangeInZone(slot.startsAt, session.endsAt, timeZone) : "Not scheduled"}
                </span>
                {roomNames ? <span>{roomNames}</span> : null}
                {session.endNotRecorded ? (
                  <span>End not recorded</span>
                ) : session.durationMinutes ? (
                  <span>{formatNumber(session.durationMinutes)} min</span>
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
          {hasDetails && (
            <div class="session-modal__body">
              {ownedRecording ? (
                <div class="session-modal__video" data-agenda-media-recording>
                  <video
                    src={ownedRecording}
                    controls
                    playsInline
                    preload="none"
                    aria-label={`Recording: ${session.title}`}
                  />
                </div>
              ) : recordingEmbed ? (
                <div class="session-modal__video" data-agenda-media-recording>
                  <iframe loading="lazy" data-video-src={recordingEmbed} title={session.title} allowFullScreen />
                </div>
              ) : null}
              {(
                session.descriptionMarkdown !== undefined ? session.descriptionMarkdown.trim() : session.descriptionHtml
              ) ? (
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
                <section class="pk-stack pk-stack--snug">
                  <h3>Speakers</h3>
                  {session.speakers.map((speaker) => (
                    <article class="speaker-card session-modal__speaker" key={speaker.name}>
                      <AgendaSpeaker speaker={speaker} detail />
                    </article>
                  ))}
                </section>
              ) : null}
            </div>
          )}
          <div class="session-modal__footer pk-cluster pk-cluster--end">
            {!editor && session.participation && (
              <AgendaParticipationControls participation={session.participation} title={session.title} detail />
            )}
            {recordingUrl && (
              <ButtonLink
                href={recordingUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-agenda-media-recording={session.recordingApproved ? "" : undefined}
              >
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
      )}
    </article>
  );
}
