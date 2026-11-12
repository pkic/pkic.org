import { format24HourClockInZone } from "./format-date";
import { liveSpeakerMessageFit, type LiveSpeakerMessageFit } from "./live-room-outputs";
import {
  liveStageDisplayQuestions,
  liveStageSpeakers,
  liveStageTitle,
  type LiveStageSpeaker,
} from "./live-stage-display";
import { formatLiveTimer } from "./live-timer-format";
import { countsUp, liveTimerCounts, liveTimerReading, liveTimerShownMs, liveTimerTone } from "./live-timer-policy";
import type { LivePoll } from "./schemas/live-session-poll";
import type {
  LiveRoomSession,
  LiveSpeakerMessage,
  LiveStage,
  LiveStageQuestion,
  LiveTimer,
  LiveTimerGraphic,
} from "./schemas/live-session-room";
import type { LiveScheduleRoom } from "./schemas/live-session-schedule";
import type { LiveStageDisplaySettings } from "./schemas/live-stage-display-settings";

/**
 * What the stage display shows at an instant, decided once for every screen
 * that draws it. The screen keeps fixed rows: a top row with the clock and
 * reactions, or a banner in their place; a main area with at most two
 * items; and a footer naming the session that is live, or the next one.
 *
 * The main area follows one order, highest first: a timer at zero or over
 * takes all of it; before the session starts it counts down to the start;
 * a question or poll sits beside the timer that ends first; else up to two
 * timers, the one ending first large. Questions, polls and timers are the
 * stage display's own when operators put any there, else Program's. The banner is the operators' message, else the near-end cue.
 */

type SessionTime = Pick<LiveRoomSession, "startAt" | "endAt" | "timeZone">;

/** One timer as a graphic reads it at an instant: its label, its text and its warning or overrun tone. */
export interface LiveTimerGraphicText {
  timerId: string;
  /** The graphic's label, or the timer's name; null when the graphic shows none. */
  name: string | null;
  /** What the label reads: the name, or before an agenda session "… starts in". */
  label: string | null;
  text: string;
  tone: "warn" | "over" | undefined;
  running: boolean;
  /** A countdown's time left, negative once over; null for a stopwatch or a clock, which never end. */
  remainingMs: number | null;
  /** An agenda session timer before its session starts: the time until it does. */
  startsInMs: number | null;
  kind: LiveTimer["kind"];
}

/** A timer graphic's reading, the same in the overlay graphics and on the stage display. */
export function liveTimerGraphicText(
  graphic: LiveTimerGraphic,
  timer: LiveTimer,
  session: SessionTime,
  now: number,
): LiveTimerGraphicText {
  const reading = liveTimerReading(timer, session, now);
  const before = reading.startsInMs !== null;
  const name = graphic.showLabel ? (graphic.label ?? timer.name) : null;
  const counts = liveTimerCounts(timer);
  return {
    timerId: timer.id,
    name,
    label: before ? (name ? `${name} starts in` : "Starts in") : name,
    // A clock reads the event's time of day on the same clock as the countdowns beside it.
    text: counts
      ? formatLiveTimer(liveTimerShownMs(timer, graphic, session, now), graphic.format, graphic.customFormat)
      : format24HourClockInZone(now, session.timeZone),
    // A start coming up is no warning.
    tone: before ? undefined : liveTimerTone(timer, reading.valueMs, graphic),
    running: reading.running,
    remainingMs: counts && !countsUp(timer) ? reading.valueMs : null,
    startsInMs: reading.startsInMs,
    kind: timer.kind,
  };
}

/**
 * The countdowns the stage display shows: its own timer graphics, else, like
 * its question and poll, those on Program. A clock is left out: the top row
 * always reads the time of day.
 */
export function liveStageDisplayGraphics(
  own: Pick<LiveStage, "timerGraphics">,
  program: Pick<LiveStage, "timerGraphics">,
  timers: readonly LiveTimer[],
): LiveTimerGraphic[] {
  const countdowns = (graphics: readonly LiveTimerGraphic[]) =>
    graphics.filter((graphic) => {
      const timer = timers.find((entry) => entry.id === graphic.timerId);
      return timer !== undefined && liveTimerCounts(timer);
    });
  const pinned = countdowns(own.timerGraphics);
  return pinned.length ? pinned : countdowns(program.timerGraphics);
}

export type LiveStageTimer = LiveTimerGraphicText & { size: "large" | "small" };

export type LiveStageContent =
  | {
      kind: "question";
      /** The question being answered; null when only the next one is lined up. */
      question: LiveStageQuestion | null;
      onAir: boolean;
      next: { question: LiveStageQuestion; votes: number | null } | null;
    }
  | { kind: "poll"; poll: LivePoll; onAir: boolean };

export type LiveStageMain =
  | { kind: "empty" }
  | { kind: "timers"; timers: LiveStageTimer[] }
  | { kind: "content"; timer: LiveStageTimer | null; content: LiveStageContent }
  | { kind: "overtime"; timer: LiveStageTimer }
  | { kind: "break"; timer: LiveStageTimer };

export interface LiveStageBanner {
  text: string;
  /** The operators' message, or the stage display's own near-end cue. */
  source: "operator" | "near-end";
  flash: boolean;
  fit: LiveSpeakerMessageFit;
}

export interface LiveStageFooter {
  marker: "live" | "next";
  title: string;
  speakers: string;
}

export interface LiveStageDisplayPlan {
  clock: string;
  banner: LiveStageBanner | null;
  /** Whether reactions may show in the top row now. */
  reactions: boolean;
  main: LiveStageMain;
  footer: LiveStageFooter;
}

export interface LiveStageDisplayInput {
  session: Pick<LiveRoomSession, "title" | "startAt" | "endAt" | "timeZone" | "credits">;
  /** The stage display's own composition: what operators pinned to it. */
  own: LiveStage;
  /** What is on air. */
  program: LiveStage;
  /** The question lined up in Preview. */
  next: LiveStageQuestion | null;
  /** Its votes, when this screen knows them. */
  nextVotes: number | null;
  polls: readonly LivePoll[];
  timers: readonly LiveTimer[];
  speakerMessage: LiveSpeakerMessage | null;
  settings: LiveStageDisplaySettings;
  /** The physical room, so the footer names what comes next in it. */
  roomId?: string;
  now: number;
}

/** The order timers end in: the least time left first; a stopwatch never ends. */
const endsBefore = (left: LiveTimerGraphicText, right: LiveTimerGraphicText) =>
  (left.remainingMs ?? Number.POSITIVE_INFINITY) - (right.remainingMs ?? Number.POSITIVE_INFINITY);

function content(input: LiveStageDisplayInput): LiveStageContent | null {
  const { own, program, polls } = input;
  const { current: question, next: lined } = liveStageDisplayQuestions(own, program, input.next);
  const next = lined ? { question: lined, votes: input.nextVotes } : null;
  if (question) return { kind: "question", question, onAir: program.question?.id === question.id, next };
  const pollId = own.poll?.id ?? program.poll?.id;
  const poll = pollId ? polls.find((entry) => entry.id === pollId) : undefined;
  if (poll) return { kind: "poll", poll, onAir: program.poll?.id === poll.id };
  return next ? { kind: "question", question: null, onAir: false, next } : null;
}

function main(input: LiveStageDisplayInput, items: readonly LiveTimerGraphicText[]): LiveStageMain {
  const large = (item: LiveTimerGraphicText): LiveStageTimer => ({ ...item, size: "large" });
  const over = items.find((item) => item.startsInMs === null && item.remainingMs !== null && item.remainingMs <= 0);
  if (over)
    return {
      kind: "overtime",
      timer: { ...large(over), label: over.remainingMs! < 0 ? `${over.name ?? "Time"} over by` : over.name },
    };
  const waiting = items.find((item) => item.startsInMs !== null);
  if (waiting) return { kind: "break", timer: { ...large(waiting), label: "Next session starts in" } };
  const ordered = [...items].sort(endsBefore);
  const shown = content(input);
  if (shown) return { kind: "content", timer: ordered[0] ? { ...ordered[0], size: "small" } : null, content: shown };
  if (!ordered.length) return { kind: "empty" };
  // At most two, each on its own side; the one that ends first is the large one.
  const pair = new Set(ordered.slice(0, 2));
  return {
    kind: "timers",
    timers: items
      .filter((item) => pair.has(item))
      .map((item) => ({ ...item, size: item === ordered[0] ? "large" : "small" })),
  };
}

/** The session's time left by its session timer, else by the agenda; null before it starts. */
function sessionLeftMs(input: LiveStageDisplayInput): number | null {
  const timer = input.timers.find((entry) => entry.kind === "session");
  if (!timer) return Date.parse(input.session.startAt) > input.now ? null : Date.parse(input.session.endAt) - input.now;
  const reading = liveTimerReading(timer, input.session, input.now);
  return reading.startsInMs === null ? reading.valueMs : null;
}

function upcoming(input: LiveStageDisplayInput): LiveScheduleRoom | undefined {
  const schedule = input.own.schedule ?? input.program.schedule;
  const rooms = schedule?.available ? schedule.rooms : [];
  return rooms.find((room) => room.roomId === input.roomId) ?? rooms[0];
}

const creditSpeakers = (credits: LiveStageDisplayInput["session"]["credits"]): LiveStageSpeaker[] =>
  credits.map((credit) => ({ name: credit.name, affiliation: credit.identity?.organization ?? null }));

export function liveStageDisplayPlan(input: LiveStageDisplayInput): LiveStageDisplayPlan {
  const { session, settings, now } = input;
  const left = sessionLeftMs(input);
  const nearEnd = settings.nearEndSeconds > 0 && left !== null && left > 0 && left <= settings.nearEndSeconds * 1000;
  const items = liveStageDisplayGraphics(input.own, input.program, input.timers).map((graphic) => {
    const item = liveTimerGraphicText(
      graphic,
      input.timers.find((timer) => timer.id === graphic.timerId)!,
      session,
      now,
    );
    // Near the end the session timer turns amber with the cue, whatever its own warning time.
    return nearEnd && item.kind === "session" && !item.tone ? { ...item, tone: "warn" as const } : item;
  });
  const shown = main(input, items);
  const message = input.speakerMessage;
  const banner: LiveStageBanner | null = message
    ? { text: message.text, source: "operator", flash: message.flash, fit: liveSpeakerMessageFit(message.text) }
    : nearEnd
      ? {
          text: settings.endsWithQuestions ? "Questions now" : "Wrap up",
          source: "near-end",
          flash: false,
          fit: "regular",
        }
      : null;
  const before = shown.kind === "break";
  const after = upcoming(input);
  const footer: LiveStageFooter = before
    ? {
        marker: "next",
        title: liveStageTitle(session.title),
        speakers: liveStageSpeakers(creditSpeakers(session.credits)),
      }
    : (nearEnd || (left !== null && left <= 0)) && after
      ? {
          marker: "next",
          title: liveStageTitle(after.title),
          speakers: liveStageSpeakers(after.speakers.map((speaker) => ({ name: speaker.name, affiliation: null }))),
        }
      : {
          marker: "live",
          title: liveStageTitle(session.title),
          speakers: liveStageSpeakers(creditSpeakers(session.credits)),
        };
  return {
    clock: format24HourClockInZone(now, session.timeZone),
    banner,
    reactions: settings.reactions && !banner && !items.some((item) => item.tone !== undefined),
    main: shown,
    footer,
  };
}
