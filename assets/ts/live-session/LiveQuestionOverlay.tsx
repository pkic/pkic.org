import { liveQuestionFit } from "../../shared/live-stage-display";
import type { OverlayRect } from "../../shared/live-overlay-geometry";
import { liveQuestionAddresseeName } from "../../shared/live-room-credits";
import type { LiveCredit, LiveStage } from "../../shared/schemas/live-session-room";
import { Avatar } from "../ui/Avatar";
import { LiveBoard } from "./LiveBoard";
import "./LiveQuestionOverlay.css";
import { LiveScreenText } from "./LiveScreenText";

/**
 * The question large beside the event stripe: whom it is for above it, when
 * the asker named someone, and who asked it under it, when they asked by name.
 */
export function LiveQuestionBody({
  question,
  credits,
}: {
  question: NonNullable<LiveStage["question"]>;
  credits: readonly LiveCredit[];
}) {
  const addressee = liveQuestionAddresseeName(credits, question.addressedTo);
  return (
    <div class="pk-live-board-question__body">
      {addressee ? (
        <p class="pk-live-board-question__addressee">
          For <strong>{addressee}</strong>
        </p>
      ) : null}
      <p class="pk-live-overlay__question-text" data-fit={liveQuestionFit(question.text)}>
        <LiveScreenText text={question.text} />
      </p>
      {question.authorName ? (
        <p class="pk-live-overlay__question-asker">
          <Avatar
            class="pk-live-board-question__asker"
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
export function LiveQuestionOverlay({
  stage,
  credits,
  box,
}: {
  stage: LiveStage;
  credits: readonly LiveCredit[];
  box: Pick<OverlayRect, "width" | "height">;
}) {
  const question = stage.question;
  if (!question) return null;
  return (
    <LiveBoard
      key={question.id}
      box={box}
      class="pk-live-board-question"
      label="Audience question"
      eyebrow="Audience question"
    >
      <LiveQuestionBody question={question} credits={credits} />
    </LiveBoard>
  );
}
