import type { ComponentChildren } from "preact";
import { formatClockInZone } from "../../shared/format-date";
import { liveQuestionAsker, liveQuestionFit } from "../../shared/live-stage-display";
import { liveTimerCounts } from "../../shared/live-timer-policy";
import type { LiveRoomState } from "./live-room-state";
import type { LiveStageQuestion, LiveTimerGraphic } from "../../shared/schemas/live-session-room";
import { useLiveTimerGraphicReading } from "./useLiveCountdown";
import { useNumericCssProperties } from "../hooks/useNumericCssProperties";
import "./LiveStageDisplay.css";

/** The timer the stage display shows, in its graphic's format and label; it steps aside for a question. */
function StageCountdown({ graphic, state }: { graphic: LiveTimerGraphic; state: LiveRoomState }) {
  const reading = useLiveTimerGraphicReading(graphic, state.timers, state.session);
  const geometry = useNumericCssProperties({
    "--timer-text-scale": Math.min(1, 10 / Math.max(reading?.text.length ?? 0, 1)),
  });
  if (!reading) return null;
  return (
    <div class="pk-live-stage-display__timer" data-numeric-css-properties={geometry}>
      {reading.label ? <p class="pk-live-stage-display__label">{reading.label}</p> : null}
      <p class="pk-live-stage-display__countdown" data-tone={reading.tone}>
        {reading.text}
      </p>
    </div>
  );
}

/**
 * A clock on the stage display: the event's time of day in one line under the
 * countdowns, smaller than they are, so it never competes with them and
 * stays clear of the operators' message along the top.
 */
function StageClock({ graphic, state }: { graphic: LiveTimerGraphic; state: LiveRoomState }) {
  const reading = useLiveTimerGraphicReading(graphic, state.timers, state.session);
  if (!reading) return null;
  return (
    <p class="pk-live-stage-display__clock">
      {reading.label ? <span class="pk-live-stage-display__label">{reading.label}</span> : null}
      <time class="pk-live-stage-display__clock-time">{reading.text}</time>
    </p>
  );
}

/** One question as the speaker reads it from the stage: its words large, who asked small under them. */
function StageQuestion({ question, label, next }: { question: LiveStageQuestion; label: string; next?: boolean }) {
  return (
    <figure class="pk-live-stage-display__question" data-next={next ? "" : undefined}>
      <p class="pk-live-stage-display__label">{label}</p>
      <p class="pk-live-stage-display__question-text" data-fit={liveQuestionFit(question.text)}>
        {question.text}
      </p>
      <p class="pk-live-stage-display__asker">{liveQuestionAsker(question)}</p>
    </figure>
  );
}

/**
 * The speaker-facing stage display, its own design rather than a copy of
 * Program: high contrast, type sized to read from the stage. The question
 * being answered now leads, with the next one lined up in Preview smaller
 * under it; the timer stays in view beside them. With no question the timer
 * fills the screen. Everything comes from the room's own state; the page that
 * hosts it may add a status at the end of the bottom line, which never
 * covers what comes next.
 */
export function LiveStageDisplay({
  state,
  roomId,
  aside,
}: {
  state: LiveRoomState;
  roomId?: string;
  aside?: ComponentChildren;
}) {
  const { session, stage, stageDisplayNext: next } = state;
  // A clock reads the time of day under the countdowns, which keep the grid to themselves.
  const isClock = (graphic: LiveTimerGraphic) =>
    state.timers.some((timer) => timer.id === graphic.timerId && !liveTimerCounts(timer));
  const clocks = stage.timerGraphics.filter(isClock);
  const countdowns = stage.timerGraphics.filter((graphic) => !isClock(graphic));
  const geometry = useNumericCssProperties({
    "--timer-columns": Math.max(1, Math.ceil(Math.sqrt(countdowns.length))),
  });
  const zone = session.timeZone;
  const rooms = stage.schedule?.available ? stage.schedule.rooms : [];
  const upcoming = rooms.find((room) => room.roomId === roomId) ?? rooms[0];
  const poll = stage.poll ? state.polls.find((entry) => entry.id === stage.poll?.id) : undefined;
  const current = stage.question;
  return (
    <div class="pk-live-stage-display" data-question={current ? "" : undefined}>
      <div class="pk-live-stage-display__session">
        <span class="pk-live-stage-display__title">{session.title}</span>
        <span class="pk-live-stage-display__end">Ends {formatClockInZone(session.endAt, zone)}</span>
      </div>
      <div class="pk-live-stage-display__main">
        {current ? <StageQuestion question={current} label="Question" /> : null}
        <div class="pk-live-stage-display__timing">
          {countdowns.length ? (
            <div class="pk-live-stage-display__timers" data-numeric-css-properties={geometry}>
              {countdowns.map((graphic) => (
                <StageCountdown key={graphic.timerId} graphic={graphic} state={state} />
              ))}
            </div>
          ) : null}
          {clocks.map((graphic) => (
            <StageClock key={graphic.timerId} graphic={graphic} state={state} />
          ))}
        </div>
      </div>
      <div class="pk-live-stage-display__after">
        {next ? (
          <StageQuestion question={next} label="Next question" next />
        ) : poll ? (
          <p class="pk-live-stage-display__line">
            <span class="pk-live-stage-display__label">Poll</span> {poll.field.label}
          </p>
        ) : upcoming ? (
          <p class="pk-live-stage-display__line">
            <span class="pk-live-stage-display__label">
              Up next {formatClockInZone(upcoming.startAt, stage.schedule?.timeZone ?? zone)}
            </span>{" "}
            {upcoming.title}
          </p>
        ) : null}
        {aside ? <div class="pk-live-stage-display__aside">{aside}</div> : null}
      </div>
    </div>
  );
}
