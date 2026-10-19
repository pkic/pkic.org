import { isPersonalAgendaSession } from "./AgendaParticipationControls";
import { agendaSpeakerSession, type AgendaSpeakerSession } from "./agenda-speaker-sessions";
import { clockTimeZone, type ClockZone } from "../../shared/event-clock";
import "../../design/tokens.agenda.generated.css";
// The agenda's stylesheets in cascade order: the base, the session details and the
// agenda design refine it, and the timeline's grid and clocks refine the design.
import "./ContentAgenda.css";
import "./AgendaSessionDetails.css";
import "./AgendaDesign.css";
import "./AgendaTimeline.css";
import { AgendaBreakSponsors } from "./AgendaBreakSponsors";
import { AgendaSpeaker, AgendaSpeakerProfileParts } from "./AgendaSpeaker";
import { AgendaSpeakerDialogsContext, type AgendaSpeakerDialogs } from "./AgendaSpeakerProfile";
import { initializeAgendaSpeakers } from "./agenda-speakers";
import { resolveAgendaDurationRules } from "../../shared/event-agenda-duration";
import { formatNumber } from "../../shared/format-number";
import { Menu } from "../ui/Menu";
import { httpOrSameOriginUrlSchema } from "../../shared/schemas/urls";
import type { ComponentChildren, JSX } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";
import { youtubeVideoEmbed } from "../../shared/markdown-media";
import { sameOriginPathSchema } from "../../shared/schemas/urls";
import { initializeAgendaSessionMedia, pauseAgendaSessionMedia } from "./agenda-session-media";
import { parseSessionRecordingPublicUrl } from "../../shared/session-recording-public-url";
import { IconClock, IconRemote, IconVideo, SessionFormatIcon } from "../ui/MediaIcons";
import { AgendaSessionActions } from "./AgendaSessionActions";
import {
  AgendaParticipationControls,
  AgendaSessionStar,
  type AgendaPersonalSession,
} from "./AgendaParticipationControls";
import { SessionAdmissionNote } from "./SessionAdmissionNote";
import { CloseButton } from "../ui/CloseButton";
import { Markdown } from "../ui/Markdown";
import { formatDateRange, formatTimeRangeInZone } from "../../shared/format-date";
import { LocalTime } from "./SiteDate";
import { DeferredImages } from "./SiteImage";
import { observeDeferredImages } from "./deferred-images";
import type {
  ContentAgendaDay,
  ContentAgendaLocation,
  ContentAgendaSessionFragment,
  ContentAgendaSpeaker,
} from "../../shared/site-agenda";

function AgendaFormatIcon({ format }: { format: { id: string; label: string } }) {
  return (
    <span class="pk-content-agenda__format" title={format.label}>
      <SessionFormatIcon format={format.id} />
      <span class="pk-sr-only">{format.label}</span>
    </span>
  );
}

/** Break content stays within the visible part of a horizontally scrolled grid. */
function AgendaBreakFrame({ isBreak, children }: { isBreak: boolean; children: ComponentChildren }) {
  return isBreak ? <div class="pk-content-agenda__break-content">{children}</div> : <>{children}</>;
}

export interface AgendaSessionEditor {
  onDurationChange?: (minutes: number) => void;
  durationDisabled?: boolean;
  durationOptions?: readonly number[];
  resizeHandle?: ComponentChildren;
  moveControls?: ComponentChildren;
  onRoomChange?: () => void;
  controls: ComponentChildren;
  /** An organizer-only status on the card, such as speakers who have not accepted yet. */
  notice?: ComponentChildren;
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
          <IconClock />
          <span>{formatNumber(session.durationMinutes)} min</span>
        </Menu>
      ) : (
        <>
          <IconClock />
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
  timeZone: clock,
  editor,
  publicAnchor,
  legacyFragments = [],
  speakerSessions,
  personal,
}: {
  session: ContentAgendaDay["slots"][number]["sessions"][number];
  slot?: Pick<ContentAgendaDay["slots"][number], "startsAt">;
  locations: ContentAgendaLocation[];
  dialogId: string;
  publicAnchor?: string;
  legacyFragments?: readonly ContentAgendaSessionFragment[];
  speakerSessions?: ReadonlyMap<string, readonly AgendaSpeakerSession[]>;
  /** The event's clock: its IANA zone, named by the event's city when the agenda carries one. */
  timeZone: ClockZone;
  editor?: AgendaSessionEditor;
  /** Portal-only viewer marks for a session that accepts participation. */
  personal?: AgendaPersonalSession;
}) {
  const timeZone = clockTimeZone(clock);
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
  // A public placeholder has nothing to open yet; organizers still edit it.
  const hasDetails = Boolean(
    editor ||
    (!session.placeholder &&
      (session.sessionUrl ||
        session.speakers.length ||
        (session.descriptionMarkdown !== undefined
          ? session.descriptionMarkdown.trim()
          : session.descriptionHtml.trim()) ||
        recordingUrl ||
        recordingEmbed ||
        session.presentationUrl ||
        session.participation ||
        onlineAccessUrl)),
  );
  const retainDialog = hasDetails || legacyFragments.length > 0;
  // Speakers the surrounding agenda has no profile for get theirs beside this card, once, not nested in the details.
  const agendaDialogs = useContext(AgendaSpeakerDialogsContext);
  const ownProfiles = new Map(
    session.speakers
      .filter((speaker) => !agendaDialogs?.profileId(speaker))
      .map((speaker, index) => [speaker, `${dialogId}-speaker-${index}`]),
  );
  const speakerDialogs: AgendaSpeakerDialogs = {
    profileId: (speaker) => agendaDialogs?.profileId(speaker) ?? ownProfiles.get(speaker),
    star: (id) => agendaDialogs?.star(id) ?? null,
    inAgenda: agendaDialogs?.inAgenda ?? false,
  };
  const sessionsOf = (speaker: ContentAgendaSpeaker) =>
    speaker.speakerKey
      ? speakerSessions?.get(speaker.speakerKey)
      : slot
        ? [agendaSpeakerSession(session, slot.startsAt, locations, speaker)].filter((entry) => entry !== undefined)
        : undefined;
  useEffect(() => {
    const element = card.current;
    if (!element || element.closest(".pk-content-agenda")) return;
    const stopMedia = initializeAgendaSessionMedia(element);
    const stopSpeakers = initializeAgendaSpeakers(element);
    const stopImages = observeDeferredImages(element);
    return () => {
      stopImages();
      stopSpeakers();
      stopMedia();
    };
  }, [
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
    <AgendaSpeakerDialogsContext.Provider value={speakerDialogs}>
      <article
        ref={card}
        id={publicAnchor}
        class={`pk-content-agenda__session pk-content-agenda__session--${locationIndex % 7}${session.kind === "break" ? " pk-content-agenda__session--break" : ""}${session.placeholder ? " pk-content-agenda__session--placeholder" : ""}`}
        data-agenda-occurrence={session.id}
        data-agenda-search-text={[session.title, ...session.speakers.map((speaker) => speaker.name)].join(" ")}
        data-agenda-kind={session.kind ?? "session"}
        data-agenda-track={session.track ?? ""}
        data-agenda-format={session.format?.id ?? ""}
        data-agenda-media-session=""
        data-agenda-mine={personal && isPersonalAgendaSession(personal) ? "" : undefined}
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
        {session.kind !== "break" && (
          <div class="pk-content-agenda__status" data-agenda-session-status hidden>
            <span data-agenda-status-label />
            <span data-agenda-status-time />
          </div>
        )}
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
        {!editor && (roomNames || session.track) ? (
          <div class="pk-content-agenda__room">
            {roomNames ? <span>{roomNames}</span> : null}
            {session.track ? <span class="pk-content-agenda__track">{session.track}</span> : null}
          </div>
        ) : null}
        <AgendaBreakFrame isBreak={session.kind === "break"}>
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
            {session.speakers.map((speaker, index) => (
              <AgendaSpeaker
                speaker={speaker}
                profileId={`${dialogId}-speaker-${index}`}
                sessions={sessionsOf(speaker)}
                timeZone={clock}
                key={index}
              />
            ))}
            {editor?.notice ? <div class="pk-content-agenda__editor-notice">{editor.notice}</div> : null}
            {session.descriptionMarkdown?.trim() ? (
              <Markdown className="pk-content-agenda__description" markdown={session.descriptionMarkdown} />
            ) : session.descriptionMarkdown === undefined && session.descriptionHtml ? (
              <div
                class="pk-content-agenda__description"
                dangerouslySetInnerHTML={{ __html: session.descriptionHtml }}
              />
            ) : null}
          </div>
          <div
            class="pk-content-agenda__card-footer"
            data-agenda-card-control
            onPointerDown={editor ? (event) => event.stopPropagation() : undefined}
            onClick={editor ? (event) => event.stopPropagation() : undefined}
          >
            <AgendaSessionActions
              session={session}
              editor={Boolean(editor)}
              recordingUrl={recordingUrl}
              recordingEmbed={recordingEmbed}
              ownedRecording={ownedRecording}
              onlineAccessUrl={onlineAccessUrl}
              dialogId={dialogId}
              openDetails={openDetails}
              personal={personal}
            />
            {session.format && session.kind !== "break" ? <AgendaFormatIcon format={session.format} /> : null}
            <AgendaSessionDuration session={session} editor={editor} />
            {session.track ? (
              <span class="pk-content-agenda__footer-track" title={session.track}>
                {session.track}
              </span>
            ) : null}
            {(session.plannedMedia?.recording || session.plannedMedia?.liveStreaming) && (
              <div class="pk-cluster" data-agenda-media-plans>
                {session.plannedMedia.recording && (
                  <span data-agenda-media-before>
                    <span class="pk-content-agenda__capability" title="Recording planned">
                      <IconVideo />
                      <span class="pk-sr-only">Recording planned</span>
                    </span>
                  </span>
                )}
                {session.plannedMedia.liveStreaming && (
                  <span data-agenda-media-live-plan>
                    <span class="pk-content-agenda__capability" title="Live streaming planned">
                      <IconRemote />
                      <span class="pk-sr-only">Live streaming planned</span>
                    </span>
                  </span>
                )}
              </div>
            )}

            {editor?.moveControls ? <div class="pk-content-agenda__move-controls">{editor.moveControls}</div> : null}
          </div>
          {session.kind === "break" && session.sponsors?.length ? (
            <AgendaBreakSponsors sponsors={session.sponsors} />
          ) : null}
        </AgendaBreakFrame>
        {editor?.resizeHandle}
        {session.endNotRecorded ? <p class="pk-content-agenda__unknown-end">End not recorded</p> : null}
        {retainDialog && (
          <dialog
            ref={detail}
            class={`session-modal${hasDetails ? "" : " session-modal--summary"}`}
            id={dialogId}
            aria-labelledby={`${dialogId}-title`}
            onClose={
              editor
                ? (event) => {
                    if (event.target === event.currentTarget) pauseAgendaSessionMedia(event.currentTarget);
                  }
                : undefined
            }
          >
            <div class="session-modal__header">
              <div class="session-modal__heading">
                {roomNames ? <span class="session-modal__location">{roomNames}</span> : null}
                {/* Opening lands on the title, not on the first header action. */}
                <h2 class="session-modal__title" id={`${dialogId}-title`} tabIndex={-1} autofocus>
                  {session.title}
                </h2>
                <div class="pk-content-agenda__metadata">
                  <span class="session-modal__when">
                    <IconClock />{" "}
                    {slot ? (
                      <>
                        {formatDateRange(slot.startsAt, undefined, timeZone)} ·{" "}
                        {/* The zone stays with its times; only the date may wrap before them. */}
                        <span class="session-modal__time">
                          {formatTimeRangeInZone(
                            slot.startsAt,
                            session.endNotRecorded ? undefined : session.endsAt,
                            clock,
                          )}
                        </span>
                      </>
                    ) : (
                      "Not scheduled"
                    )}
                  </span>
                  {session.endNotRecorded ? (
                    <span>End not recorded</span>
                  ) : session.durationMinutes ? (
                    <span>{formatNumber(session.durationMinutes)} min</span>
                  ) : null}
                </div>
                {slot && (
                  <div
                    class="pk-content-agenda__metadata"
                    data-local-time-container
                    data-event-time-zone={timeZone}
                    hidden
                  >
                    <span>
                      Your time · <LocalTime value={slot.startsAt} format="date-time" />
                      {!session.endNotRecorded && session.endsAt ? (
                        <>
                          {" "}
                          – <LocalTime value={session.endsAt} format="date-time" />
                        </>
                      ) : null}
                    </span>
                  </div>
                )}
                {!editor && session.participation ? (
                  <SessionAdmissionNote note={session.participation.policyLabel} />
                ) : null}
              </div>
              <div class="session-modal__tools">
                {!editor && session.participation ? (
                  <AgendaSessionStar participation={session.participation} title={session.title} personal={personal} />
                ) : null}
                {editor?.detailControls?.(() => detail.current?.close())}
                {!editor && personal?.headerActions}
                <CloseButton
                  label="Close session details"
                  data-agenda-close-session
                  onClick={editor ? (event) => event.currentTarget.closest("dialog")?.close() : undefined}
                />
              </div>
            </div>
            {hasDetails && (
              <DeferredImages>
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
                  <AgendaSessionActions
                    session={session}
                    editor={Boolean(editor)}
                    detail
                    recordingUrl={recordingUrl}
                    recordingEmbed={recordingEmbed}
                    ownedRecording={ownedRecording}
                    onlineAccessUrl={onlineAccessUrl}
                    dialogId={dialogId}
                    openDetails={openDetails}
                    personal={personal}
                  />
                  {(
                    session.descriptionMarkdown !== undefined
                      ? session.descriptionMarkdown.trim()
                      : session.descriptionHtml
                  ) ? (
                    <section class="session-modal__section">
                      <h3>Abstract</h3>
                      {session.descriptionMarkdown !== undefined ? (
                        <Markdown markdown={session.descriptionMarkdown} />
                      ) : (
                        <div dangerouslySetInnerHTML={{ __html: session.descriptionHtml }} />
                      )}
                    </section>
                  ) : null}
                  {session.speakers.length ? (
                    <section class="session-modal__section">
                      <h3>Speakers</h3>
                      {session.speakers.map((speaker, index) => (
                        <article class="speaker-card session-modal__speaker" key={index}>
                          <AgendaSpeaker
                            speaker={speaker}
                            detail
                            profileId={`${dialogId}-speaker-${index}`}
                            sessions={sessionsOf(speaker)}
                            timeZone={clock}
                          />
                        </article>
                      ))}
                    </section>
                  ) : null}
                  {!editor && session.participation ? (
                    personal ? (
                      personal.detail
                    ) : (
                      <AgendaParticipationControls participation={session.participation} title={session.title} detail />
                    )
                  ) : null}
                </div>
              </DeferredImages>
            )}
          </dialog>
        )}
        {ownProfiles.size ? (
          <div class="pk-agenda-dialogs">
            {[...ownProfiles].map(([speaker, id]) => (
              <AgendaSpeakerProfileParts
                key={id}
                speaker={speaker}
                profileId={id}
                sessions={sessionsOf(speaker)}
                timeZone={clock}
              />
            ))}
          </div>
        ) : null}
      </article>
    </AgendaSpeakerDialogsContext.Provider>
  );
}
