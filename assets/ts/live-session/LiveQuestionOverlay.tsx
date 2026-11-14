import { liveQuestionFit } from "../../shared/live-stage-display";
import type { OverlayRect } from "../../shared/live-overlay-geometry";
import type { LiveStage } from "../../shared/schemas/live-session-room";
import { Avatar } from "../ui/Avatar";
import { LiveBoard } from "./LiveBoard";
import "./LiveQuestionOverlay.css";

/** The question large beside the event stripe, and who asked it when they asked by name. */
export function LiveQuestionBody({ question }: { question: NonNullable<LiveStage["question"]> }) {
  return (
    <div class="pk-live-question__body">
      <p class="pk-live-overlay__question-text" data-fit={liveQuestionFit(question.text)}>
        {question.text}
      </p>
      {question.authorName ? (
        <p class="pk-live-overlay__question-asker">
          <Avatar
            class="pk-live-question__asker"
            name={question.authorName}
            src={question.authorPhotoUrl ?? undefined}
            sizes="96px"
            decoding="async"
          />
          {question.authorName}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The audience question on air, on the conference board. An anonymous
 * question needs no byline; the eyebrow already says whose it is.
 */
export function LiveQuestionOverlay({ stage, box }: { stage: LiveStage; box: Pick<OverlayRect, "width" | "height"> }) {
  const question = stage.question;
  if (!question) return null;
  return (
    <LiveBoard
      key={question.id}
      box={box}
      class="pk-live-question"
      label="Audience question"
      eyebrow="Audience question"
    >
      <LiveQuestionBody question={question} />
    </LiveBoard>
  );
}
