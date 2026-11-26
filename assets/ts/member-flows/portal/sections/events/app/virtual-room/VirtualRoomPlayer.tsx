import { formatLiveTimer } from "../../../../../../../shared/live-timer-format";
import { useLiveTimerNow } from "../../../../../../live-session/useLiveCountdown";
import { useMinuteClock } from "../../../../../../live-session/useLiveWindow";
import { formatDuration } from "../../../../../../../shared/format-date";
import { clockTimeZone, type ClockZone } from "../../../../../../../shared/event-clock";
import { instantToCalendarDate } from "../../../../../../../shared/timezone";
/**
 * The location's live player and what is on it: the venue screens' player for the day's stream, then
 * the running session's title and speakers, which follow the published agenda as sessions change.
 */
import type { ComponentChildren } from "preact";
import type { LiveStream } from "../../../../../../../shared/schemas/event-live-stream";
import { eventSessionRoute } from "../../../../../../../shared/event-participation-link";
import { usePortalHashLocation } from "../../../../hash-location";
import { JoinSessionMeeting } from "../../detail/participation/JoinSessionMeeting";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import type { RoomMoment } from "./virtual-room-schedule";
import { VirtualRoomSpeakerFaces } from "./VirtualRoomSpeakerFaces";
import "../../../../../../ui/Content.css";
import "./VirtualRoom.css";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import { IconSound, IconVirtual, IconVirtualOff } from "../../../../../../ui/MediaIcons";
import { Button } from "../../../../../../ui/Button";
import { useLivestreamPlayer } from "../../../../../../event-screens/useLivestreamPlayer";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import "../../../../../../../design/tokens.event.generated.css";
import "../EventHero.css";
import { useEventHeroMotif } from "../EventHero";

export function VirtualRoomPlayer({
  stream,
  locationName,
  startsAt,
  inPerson = false,
  motifUrl = null,
}: {
  stream: LiveStream | null;
  locationName: string;
  startsAt?: string;
  /** The event's own artwork, along the foot of the card an in-person attendee starts the stream from. */
  motifUrl?: string | null;
  /** The attendee holds an in-person seat: the stream waits for a click rather than playing in the hall. */
  inPerson?: boolean;
}) {
  const [started, setStarted] = useState(!inPerson);
  if (!stream) return <WaitingRoomPlayer locationName={locationName} startsAt={startsAt} />;
  // One provider today; another joins here as its own player when the stream union grows.
  if (!started)
    return (
      <VirtualRoomCard
        motifUrl={motifUrl}
        eyebrow={
          <>
            <IconVirtual width={12} height={12} />
            {locationName} · Streamed
          </>
        }
        title="Streams don't play by themselves for in-person attendees"
      >
        <div class="pk-event-hero__actions">
          <Button onClick={() => setStarted(true)}>Watch the stream</Button>
        </div>
      </VirtualRoomCard>
    );
  return (
    <StreamPlayer
      key={stream.videoId}
      videoId={stream.videoId}
      title={`${locationName} live stream`}
      sound={inPerson}
    />
  );
}

/** How long the sound control stays in view after the pointer last moved over a stream that has sound. */
const SOUND_CONTROL_SHOWN_MS = 3_000;

/**
 * The stream on the venue screens' player: no provider controls and no way out to the provider's site, so
 * attendees stay in the room. It plays at once, muted unless a click started it, and keeps to the live edge.
 * While muted, a labeled button opens in the middle of the picture, then settles in its top-left corner and
 * keeps beating until the sound is on; with sound, a small button there turns it off, shown only while the
 * pointer moves over the picture so nothing covers the stream.
 */
function StreamPlayer({ videoId, title, sound: startWithSound }: { videoId: string; title: string; sound: boolean }) {
  const [sound, setSoundOn] = useState(startWithSound);
  const player = useLivestreamPlayer({ videoId, title, sound, keepLive: true, report: false });
  const audible = sound && !player.health.muted;
  const [controlShown, showControl] = useShownWhileActive(SOUND_CONTROL_SHOWN_MS);
  const toggle = () => {
    setSoundOn(!audible);
    player.setSound(!audible);
    showControl();
  };
  return (
    <div
      class="pk-virtual-room__player pk-virtual-room__stream"
      onPointerMove={showControl}
      onPointerDown={showControl}
    >
      <div ref={player.host} class="pk-embed pk-virtual-room__stream-host" />
      {player.health.reconnecting ? (
        <p class="pk-virtual-room__stream-status" role="status">
          Reconnecting to the stream…
        </p>
      ) : null}
      {audible ? (
        <Button
          icon
          variant="ghost"
          class={`pk-virtual-room__sound${controlShown ? "" : " pk-virtual-room__sound--resting"}`}
          aria-label="Mute"
          title="Mute"
          onClick={toggle}
        >
          <IconSound audible />
        </Button>
      ) : (
        <Button variant="primary" class="pk-virtual-room__unmute" onClick={toggle}>
          <IconSound audible={false} />
          Turn sound on
        </Button>
      )}
    </div>
  );
}

/** Whether a control is in view: shown on activity, then hidden again once nothing has happened for `ms`. */
function useShownWhileActive(ms: number): [boolean, () => void] {
  const [shown, setShown] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback(() => {
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), ms);
  }, [ms]);
  useEffect(() => {
    show();
    return () => clearTimeout(timer.current);
  }, [show]);
  return [shown, show];
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
  return (
    <VirtualRoomCard
      motifUrl={motifUrl}
      eyebrow={
        <>
          <IconVirtualOff width={12} height={12} />
          {locationName} · {recordingPlanned ? "Not streamed · Recording planned" : "Not streamed"}
        </>
      }
      title="Ask questions and chat here during its sessions"
    />
  );
}

/** The event app's header field where the stream would stand, with the event's own motif along its foot. */
function VirtualRoomCard({
  motifUrl,
  eyebrow,
  title,
  children,
}: {
  motifUrl: string | null;
  eyebrow: ComponentChildren;
  title: string;
  children?: ComponentChildren;
}) {
  const motif = useEventHeroMotif(motifUrl);
  return (
    <div class="pk-event-hero pk-event-hero--compact pk-virtual-room__in-room">
      <div class="pk-event-hero__field">
        <span class="pk-event-hero__houses" aria-hidden="true" ref={motif} />
        <div class="pk-event-hero__subject">
          <p class="pk-event-hero__eyebrow">{eyebrow}</p>
          <p class="pk-virtual-room__in-room-title">{title}</p>
          {children}
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
