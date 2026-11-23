import { formatLiveTimer } from "../../../../../../../shared/live-timer-format";
import { useLiveTimerNow } from "../../../../../../live-session/useLiveCountdown";
import { useMinuteClock } from "../../../../../../live-session/useLiveWindow";
import { formatDuration } from "../../../../../../../shared/format-date";
import { clockTimeZone, type ClockZone } from "../../../../../../../shared/event-clock";
import { instantToCalendarDate } from "../../../../../../../shared/timezone";
/**
 * The location's live player and what is on it: YouTube's privacy-enhanced player for the day's stream, then
 * the running session's title and speakers, which follow the published agenda as sessions change.
 */
import type { ComponentChildren } from "preact";
import type { LiveStream } from "../../../../../../../shared/schemas/event-live-stream";
import { youtubePrivacyEmbedUrl } from "../../../../../../../shared/youtube-video";
import { eventSessionRoute } from "../../../../../../../shared/event-participation-link";
import { usePortalHashLocation } from "../../../../hash-location";
import { JoinSessionMeeting } from "../../detail/participation/JoinSessionMeeting";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import type { RoomMoment } from "./virtual-room-schedule";
import { VirtualRoomSpeakerFaces } from "./VirtualRoomSpeakerFaces";
import "../../../../../../ui/Content.css";
import "./VirtualRoom.css";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import { IconVirtualOff } from "../../../../../../ui/MediaIcons";
import "../../../../../../../design/tokens.event.generated.css";
import "../EventHero.css";
import { useEventHeroMotif } from "../EventHero";

export function VirtualRoomPlayer({
  stream,
  locationName,
  startsAt,
}: {
  stream: LiveStream | null;
  locationName: string;
  startsAt?: string;
}) {
  if (!stream) return <WaitingRoomPlayer locationName={locationName} startsAt={startsAt} />;
  // One provider today; another joins here as its own player when the stream union grows.
  return (
    <div class="pk-virtual-room__player">
      <iframe
        key={stream.videoId}
        class="pk-embed"
        src={youtubePrivacyEmbedUrl(stream.videoId)}
        title={`${locationName} live stream`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

function WaitingRoomPlayer({ locationName, startsAt }: { locationName: string; startsAt?: string }) {
  const now = useLiveTimerNow(Boolean(startsAt));
  const remaining = startsAt ? Math.max(0, Date.parse(startsAt) - now) : null;
  return (
    <div class="pk-virtual-room__player pk-virtual-room__player--idle pk-center">
      <div class="pk-stack pk-stack--snug">
        <SectionHeading level={3}>{locationName}</SectionHeading>
        {remaining !== null && remaining > 0 ? (
          <>
            <p>Starts in</p>
            <p class="pk-virtual-room__countdown pk-mono" role="timer" aria-live="off">
              {formatLiveTimer(remaining, "custom", "{{days}}d {{hours}}h {{minutes}}m {{seconds}}s")}
            </p>
          </>
        ) : (
          <p>Waiting for the broadcast to begin</p>
        )}
      </div>
    </div>
  );
}

/**
 * A location held in the room only. The event app's header field stands where the stream would, with the
 * event's own motif, so the room keeps the conference's look while questions and chat go on. It says what
 * the organizers plan for the location and promises nothing beyond it.
 */
export function VirtualRoomInRoom({
  locationName,
  recordingPlanned,
  motifUrl,
}: {
  locationName: string;
  recordingPlanned: boolean;
  motifUrl: string | null;
}) {
  const motif = useEventHeroMotif(motifUrl);
  return (
    <div class="pk-event-hero pk-event-hero--compact pk-virtual-room__in-room">
      <div class="pk-event-hero__field">
        <span class="pk-event-hero__houses" aria-hidden="true" ref={motif} />
        <div class="pk-event-hero__subject">
          <p class="pk-event-hero__eyebrow">
            <IconVirtualOff width={12} height={12} />
            {locationName} · {recordingPlanned ? "Not streamed · Recording planned" : "Not streamed"}
          </p>
          <p class="pk-virtual-room__in-room-title">Ask questions and chat here during its sessions</p>
        </div>
      </div>
    </div>
  );
}

/** "in 12 min" while the next session starts later on the viewer's day; another day already shows its date. */
export function sessionStartsIn(startAt: string, now: number, zone: ClockZone): string | null {
  const ms = Date.parse(startAt) - now;
  const day = (instant: string | Date) => instantToCalendarDate(instant, clockTimeZone(zone));
  if (!(ms > 0) || day(startAt) !== day(new Date(now))) return null;
  return `in ${formatDuration(Math.max(ms, 60_000))}`;
}

/** The wait for the next session, read again every half minute without redrawing the room around it. */
function StartsIn({ startAt, format }: { startAt: string; format: (startAt: string, now: number) => string | null }) {
  const text = format(startAt, useMinuteClock());
  // Out of the live region: a wait that changes every minute must not be read out every minute.
  return text ? <span aria-hidden="true"> · {text}</span> : null;
}

/**
 * The running session under the player, or what comes next between sessions: its time, behind a live dot
 * while it runs, with its people's portraits, then the title and the reactions. A wide window also names
 * the speakers under the title.
 */
export function VirtualRoomNowPlaying({
  slug,
  moment,
  formatTime,
  organizations,
  tour,
  reactions,
  startsIn,
}: {
  /** How long until the next session starts, shown beside its time: `sessionStartsIn` in the viewer's zone. */
  startsIn?: (startAt: string, now: number) => string | null;
  slug: string;
  moment: RoomMoment;
  /** The agenda's organizations, for the people's cards. */
  organizations?: AgendaSnapshot["speakerOrganizations"];
  formatTime: (startAt: string, endAt: string) => string;
  /** The room tour's button, where the line carries it: a phone's room with one location has no location tabs. */
  tour?: ComponentChildren;
  /** The running session's reaction bar. */
  reactions?: ComponentChildren;
}) {
  const session = moment.current;
  const shown = session ?? moment.upcoming[0];
  return (
    <section class="pk-virtual-room__now" aria-label="Now in this room">
      <div class="pk-virtual-room__now-text" aria-live="polite">
        {shown ? (
          <>
            <p class="pk-event-card__eyebrow pk-virtual-room__when">
              {session ? (
                <>
                  <span class="pk-virtual-room__live-dot" aria-hidden="true" />
                  <span class="pk-sr-only">Live now, </span>
                </>
              ) : (
                "Up next · "
              )}
              {formatTime(shown.startAt, shown.endAt)}
              {!session && startsIn ? <StartsIn startAt={shown.startAt} format={startsIn} /> : null}
            </p>
            <div class="pk-virtual-room__headline">
              <VirtualRoomSpeakerFaces session={shown} organizations={organizations} />
              <SectionHeading level={3} class="pk-virtual-room__title">
                <a href={usePortalHashLocation.hrefs(eventSessionRoute(slug, shown.id))}>{shown.title}</a>
              </SectionHeading>
            </div>
          </>
        ) : (
          <p class="pk-event-card__meta">No more sessions in this location today.</p>
        )}
      </div>
      {reactions}
      {session?.onlineAccessAvailable && (
        <div class="pk-cluster pk-virtual-room__now-actions">
          <JoinSessionMeeting slug={slug} sessionId={session.id} primary={false} label="Join the meeting" />
        </div>
      )}
      {tour}
    </section>
  );
}
