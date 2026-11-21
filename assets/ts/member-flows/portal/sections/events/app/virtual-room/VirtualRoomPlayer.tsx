import { formatLiveTimer } from "../../../../../../../shared/live-timer-format";
import { useLiveTimerNow } from "../../../../../../live-session/useLiveCountdown";
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
import { sessionSpeakerLine, type RoomMoment } from "./virtual-room-schedule";
import { VirtualRoomSpeakerFaces } from "./VirtualRoomSpeakerFaces";
import "../../../../../../ui/Content.css";
import "./VirtualRoom.css";
import { SectionHeading } from "../../../../../../ui/SectionHeading";

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
 * The running session under the player, or what comes next between sessions: its time, behind a live dot
 * while it runs, with its people's portraits, then the title and the reactions. A wide window also names
 * the speakers under the title.
 */
export function VirtualRoomNowPlaying({
  slug,
  moment,
  formatTime,
  organizations,
  location,
  reactions,
}: {
  slug: string;
  moment: RoomMoment;
  /** The agenda's organizations, for the people's cards. */
  organizations?: AgendaSnapshot["speakerOrganizations"];
  formatTime: (startAt: string, endAt: string) => string;
  /** The location picker, where the line carries it. */
  location?: ComponentChildren;
  /** The running session's reaction bar. */
  reactions?: ComponentChildren;
}) {
  const session = moment.current;
  const shown = session ?? moment.upcoming[0];
  return (
    <section class="pk-virtual-room__now" aria-label="Now in this room">
      {location}
      <div class="pk-virtual-room__now-text" aria-live="polite">
        {shown ? (
          <>
            <div class="pk-virtual-room__when">
              <p class="pk-event-card__eyebrow">
                {session ? (
                  <>
                    <span class="pk-virtual-room__live-dot" aria-hidden="true" />
                    <span class="pk-sr-only">Live now, </span>
                  </>
                ) : (
                  "Up next · "
                )}
                {formatTime(shown.startAt, shown.endAt)}
              </p>
              <VirtualRoomSpeakerFaces session={shown} organizations={organizations} />
            </div>
            <SectionHeading level={3} class="pk-virtual-room__title">
              <a href={usePortalHashLocation.hrefs(eventSessionRoute(slug, shown.id))}>{shown.title}</a>
            </SectionHeading>
            {shown.speakers.length > 0 && <p class="pk-event-card__meta">{sessionSpeakerLine(shown)}</p>}
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
    </section>
  );
}
