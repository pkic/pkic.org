import { useEffect, useState } from "preact/hooks";
import type { LiveScheduleProjection, LiveScheduleRoom } from "../../shared/schemas/live-session-schedule";
import { formatClockInZone, formatClockName } from "../../shared/format-date";
import { formatNumber } from "../../shared/format-number";
import type { OverlayRect } from "../../shared/live-overlay-geometry";
import { Avatar } from "../ui/Avatar";
import { SectionHeading } from "../ui/SectionHeading";
import "./LiveGraphicTheme.css";
import "./LiveScheduleOverlay.css";

/** From this many rooms the graphic brings one room forward at a time, so each can be read in full. */
export const LIVE_SCHEDULE_SPOTLIGHT_MIN = 3;
/** How long each room stays forward. */
export const LIVE_SCHEDULE_SPOTLIGHT_MS = 6000;
/** Faces a room shows before it counts the rest: a panel of six fits whole. */
const FACES_SHOWN = 6;
/**
 * Speakers a room names on its one line, all at once. A larger panel names
 * one speaker at a time instead, their face brought forward, so every name
 * is read in full rather than cut short.
 */
export const LIVE_SCHEDULE_NAMES_SHOWN = 2;
/** How long each speaker of a larger panel stays named. */
export const LIVE_SCHEDULE_SPEAKER_TURN_MS = 3500;

/** Who speaks, by name, the moderator marked, on one line. */
export function liveScheduleSpeakerLine(speakers: LiveScheduleRoom["speakers"]): string {
  return speakers.map((speaker) => (speaker.moderator ? `${speaker.name} (moderator)` : speaker.name)).join(", ");
}

/**
 * The width the graphic is set at before its layout box scales it: as wide as
 * a full-frame box, narrower for a column or a corner, so a small box still
 * gets type large enough to read rather than a shrunken full-frame picture.
 */
export type LiveScheduleFit = "wide" | "medium" | "narrow";
export function liveScheduleFit(box: Pick<OverlayRect, "width">): LiveScheduleFit {
  return box.width >= 1280 ? "wide" : box.width >= 800 ? "medium" : "narrow";
}

/** The most cards that fit side by side on a wide box; more rooms than this read better as rows. */
const LIVE_SCHEDULE_CARDS_MAX = 4;

/**
 * Cards when the operator chose them, the box is wide and the rooms fill one
 * row of them; otherwise rows, which read well at any size and any count.
 */
export function liveScheduleArrangement(
  layout: LiveScheduleProjection["config"]["layout"],
  fit: LiveScheduleFit,
  rooms: number,
): "cards" | "rows" {
  return layout === "cards" &&
    fit === "wide" &&
    rooms >= LIVE_SCHEDULE_SPOTLIGHT_MIN &&
    rooms <= LIVE_SCHEDULE_CARDS_MAX
    ? "cards"
    : "rows";
}

/** The room brought forward now, or null when every room stays as it is. */
function useSpotlight(count: number, animate: boolean): number | null {
  const cycling = count >= LIVE_SCHEDULE_SPOTLIGHT_MIN && animate;
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
    if (!cycling) return;
    const step = setInterval(() => setIndex((current) => (current + 1) % count), LIVE_SCHEDULE_SPOTLIGHT_MS);
    return () => clearInterval(step);
  }, [cycling, count]);
  return cycling ? index % count : null;
}

/**
 * The speaker named now, or null when the room names them all at once. A
 * larger panel always takes turns: the graphic is made for the stream, where
 * no viewer's motion preference applies.
 */
function useSpeakerTurn(count: number): number | null {
  const turning = count > LIVE_SCHEDULE_NAMES_SHOWN;
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
    if (!turning) return;
    const step = setInterval(() => setIndex((current) => current + 1), LIVE_SCHEDULE_SPEAKER_TURN_MS);
    return () => clearInterval(step);
  }, [turning, count]);
  return turning ? index % Math.min(count, FACES_SHOWN) : null;
}

/** The second line of a speaker named in turn: their part on the panel and their organization. */
function speakerDetail(speaker: LiveScheduleRoom["speakers"][number]): string {
  return [speaker.moderator ? "Moderator" : null, speaker.organization].filter(Boolean).join(" · ");
}

/**
 * Who speaks, under the session's title: their faces overlapping, then their
 * names on one line; a larger panel names one speaker at a time, their face
 * brought forward, and every name holds the same place so the graphic keeps its size.
 */
function Speakers({ speakers }: { speakers: LiveScheduleRoom["speakers"] }) {
  const turn = useSpeakerTurn(speakers.length);
  if (!speakers.length) return null;
  const shown = speakers.slice(0, FACES_SHOWN);
  const more = speakers.length - FACES_SHOWN;
  return (
    <div class="pk-live-schedule__speakers" data-turning={turn === null ? undefined : ""}>
      <ul class="pk-live-schedule__faces" aria-hidden="true">
        {shown.map((speaker, index) => (
          <li
            key={`${index}:${speaker.name}`}
            class="pk-live-schedule__face"
            data-active={turn === index ? "" : undefined}
          >
            <Avatar name={speaker.name} src={speaker.photoUrl ?? undefined} size="lg" decoding="async" />
          </li>
        ))}
        {more > 0 ? <li class="pk-live-schedule__more">+{formatNumber(more)}</li> : null}
      </ul>
      {turn === null ? (
        <p class="pk-live-schedule__names">{liveScheduleSpeakerLine(speakers)}</p>
      ) : (
        <ul class="pk-live-schedule__turns">
          {shown.map((speaker, index) => (
            <li
              key={`${index}:${speaker.name}`}
              class="pk-live-schedule__turn"
              data-active={turn === index ? "" : undefined}
              aria-hidden={turn === index ? undefined : "true"}
            >
              <span class="pk-live-schedule__turn-name">{speaker.name}</span>
              <span class="pk-live-schedule__turn-detail">{speakerDetail(speaker)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What comes next in each room, from the approved public agenda, as a
 * broadcast graphic: the room and its start time lead, then the session and,
 * under it, its speakers' faces and names. With several rooms one room at a
 * time comes forward while the others keep their place; with
 * no motion (a monitor whose viewer prefers reduced motion) every room stays as it is. It takes its colors from the
 * operator's theme and its width from the layout box it is drawn into.
 */
export function LiveScheduleOverlay({
  schedule,
  box = { width: 1680 },
  animate,
}: {
  schedule: LiveScheduleProjection | null;
  /** The layout box in frame pixels, so the graphic is set for its shape; a full-frame box by default. */
  box?: Pick<OverlayRect, "width">;
  /** Whether the rooms may move: always on air, and on a monitor unless its viewer prefers reduced motion. */
  animate: boolean;
}) {
  const rooms = schedule?.available ? schedule.rooms : [];
  const spotlight = useSpotlight(rooms.length, animate);
  if (!schedule || !rooms.length) return null;
  const zone = schedule.timeZone;
  const fit = liveScheduleFit(box);
  return (
    <section
      class="pk-live-schedule"
      data-graphic-theme={schedule.config.theme}
      data-arrangement={liveScheduleArrangement(schedule.config.layout, fit, rooms.length)}
      data-fit={fit}
      data-spotlight={spotlight === null ? undefined : ""}
      data-rooms={rooms.length > 1 ? "many" : "one"}
      aria-label="Up next"
    >
      <div class="pk-live-schedule__card">
        <header class="pk-live-schedule__header">
          <SectionHeading level={2} class="pk-live-schedule__heading">
            Up next
          </SectionHeading>
          {/* Viewers far away read whose clock the times are on. */}
          {zone ? <span class="pk-live-schedule__zone">{formatClockName(zone)}</span> : null}
        </header>
        <ol class="pk-live-schedule__rooms">
          {rooms.map((room, index) => {
            // The stream's own room goes without saying; another room is named.
            const elsewhere = room.roomId !== schedule.streamRoomId;
            return (
              <li
                key={room.roomId}
                class="pk-live-schedule__room"
                data-accent={room.roomIndex % 6}
                data-active={spotlight === index ? "" : undefined}
              >
                <p class="pk-live-schedule__when">
                  <time dateTime={room.startAt}>{zone ? formatClockInZone(room.startAt, zone) : ""}</time>
                </p>
                {elsewhere ? <p class="pk-live-schedule__room-name">{room.roomName}</p> : null}
                <SectionHeading level={3} class="pk-live-schedule__title">
                  {room.title}
                </SectionHeading>
                <Speakers speakers={room.speakers} />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
