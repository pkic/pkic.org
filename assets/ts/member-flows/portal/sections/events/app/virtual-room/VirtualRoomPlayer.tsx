import { formatLiveTimer } from "../../../../../../../shared/live-timer-policy";
import { useLiveTimerNow } from "../../../../../../live-session/useLiveCountdown";
/**
 * The location's live player and what is on it: YouTube's privacy-enhanced player for the day's stream, then
 * the running session's title and speakers, which follow the published agenda as sessions change.
 */
import type { LiveStream } from "../../../../../../../shared/schemas/event-live-stream";
import { youtubePrivacyEmbedUrl, youtubeWatchUrl } from "../../../../../../../shared/youtube-video";
import { eventSessionRoute } from "../../../../../../../shared/event-participation-link";
import { usePortalHashLocation } from "../../../../hash-location";
import { JoinSessionMeeting } from "../../detail/participation/JoinSessionMeeting";
import { sessionSpeakerLine, type RoomMoment } from "./virtual-room-schedule";
import "../../../../../../ui/Content.css";
import "./VirtualRoom.css";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import { ExternalLink } from "../../../../../../ui/ExternalLink";

export function VirtualRoomPlayer({
  stream,
  locationName,
  presentation = "watch",
  startsAt,
}: {
  stream: LiveStream | null;
  locationName: string;
  presentation?: "watch" | "monitor";
  startsAt?: string;
}) {
  if (!stream && presentation === "monitor")
    return (
      <div
        class="pk-virtual-room__player pk-virtual-room__player--monitor"
        role="img"
        aria-label={`${locationName}: no livestream`}
      >
        <span>No livestream</span>
      </div>
    );
  if (!stream) return <WaitingRoomPlayer locationName={locationName} startsAt={startsAt} />;
  // One provider today; another joins here as its own player when the stream union grows.
  return (
    <div class={`pk-virtual-room__player${presentation === "monitor" ? " pk-virtual-room__player--monitor" : ""}`}>
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

/** The running session under the player, or what comes next between sessions. */
export function VirtualRoomNowPlaying({
  slug,
  moment,
  stream,
  formatTime,
}: {
  slug: string;
  moment: RoomMoment;
  stream: LiveStream | null;
  formatTime: (startAt: string, endAt: string) => string;
}) {
  const session = moment.current;
  const next = moment.upcoming[0];
  return (
    <section class="pk-virtual-room__now pk-stack pk-stack--snug" aria-live="polite" aria-label="Now in this room">
      {session ? (
        <>
          <p class="pk-event-card__eyebrow">Live now · {formatTime(session.startAt, session.endAt)}</p>
          <SectionHeading level={3} class="pk-virtual-room__title">
            <a href={usePortalHashLocation.hrefs(eventSessionRoute(slug, session.id))}>{session.title}</a>
          </SectionHeading>
          {session.speakers.length > 0 && <p class="pk-event-card__meta">{sessionSpeakerLine(session)}</p>}
          {session.onlineAccessAvailable && (
            <div class="pk-cluster">
              <JoinSessionMeeting slug={slug} sessionId={session.id} primary={false} label="Join the meeting" />
            </div>
          )}
        </>
      ) : next ? (
        <>
          <p class="pk-event-card__eyebrow">Up next · {formatTime(next.startAt, next.endAt)}</p>
          <SectionHeading level={3} class="pk-virtual-room__title">
            <a href={usePortalHashLocation.hrefs(eventSessionRoute(slug, next.id))}>{next.title}</a>
          </SectionHeading>
          {next.speakers.length > 0 && <p class="pk-event-card__meta">{sessionSpeakerLine(next)}</p>}
        </>
      ) : (
        <p class="pk-event-card__meta">No more sessions in this location today.</p>
      )}
      {stream && (
        <p class="pk-small pk-muted">
          Player not starting?{" "}
          <ExternalLink href={youtubeWatchUrl(stream.videoId)} external>
            Watch on YouTube
          </ExternalLink>
        </p>
      )}
    </section>
  );
}
