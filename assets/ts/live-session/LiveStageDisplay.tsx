import { formatClockInZone } from "../../shared/format-date";
import { liveQuestionAsker, liveQuestionFit } from "../../shared/live-stage-display";
import type { LiveRoomState } from "./live-room-state";
import type { LiveStageQuestion, LiveTimerGraphic } from "../../shared/schemas/live-session-room";
import { useLiveTimerReading } from "./useLiveCountdown";
import "./LiveStageDisplay.css";

/** The timer the stage display shows, in its graphic's format and label; it steps aside for a question. */
function StageCountdown({ graphic, state }: { graphic: LiveTimerGraphic; state: LiveRoomState }) {
  const reading = useLiveTimerReading(graphic, state.timers, state.session);
  if (!reading) return null;
  return (
    <div
      class="pk-live-stage-display__timer"
      style={{ "--timer-text-scale": Math.min(1, 10 / Math.max(reading.text.length, 1)) }}
    >
      {reading.label ? <p class="pk-live-stage-display__label">{reading.label}</p> : null}
      <p class="pk-live-stage-display__countdown" data-tone={reading.tone}>
        {reading.text}
      </p>
    </div>
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
 * fills the screen. Everything comes from the room's own state.
 */
export function LiveStageDisplay({ state, roomId }: { state: LiveRoomState; roomId?: string }) {
  const { session, stage, stageDisplayNext: next } = state;
  const zone = session.timeZone;
  const rooms = stage.schedule?.available ? stage.schedule.rooms : [];
  const upcoming = rooms.find((room) => room.roomId === roomId) ?? rooms[0];
  const poll = stage.poll ? state.polls.find((entry) => entry.id === stage.poll?.id) : undefined;
  const current = stage.question;
  return (
    <div class="pk-live-stage-display" data-question={current ? "" : undefined}>
      <div class="pk-live-stage-display__session">
        <span>{session.title}</span>
        <span>Ends {formatClockInZone(session.endAt, zone)}</span>
      </div>
      <div class="pk-live-stage-display__main">
        {current ? <StageQuestion question={current} label="Question" /> : null}
        <div
          class="pk-live-stage-display__timers"
          style={{ "--timer-columns": Math.max(1, Math.ceil(Math.sqrt(stage.timerGraphics.length))) }}
        >
          {stage.timerGraphics.map((graphic) => (
            <StageCountdown key={graphic.timerId} graphic={graphic} state={state} />
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
      </div>
    </div>
  );
}
