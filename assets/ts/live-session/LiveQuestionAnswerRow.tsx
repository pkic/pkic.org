import { formatNumber } from "../../shared/format-number";
import {
  liveModerationReasonLabel,
  liveParticipationActions,
  type LiveModerationReason,
} from "../../shared/live-moderation-policy";
import type { LiveQuestionAnswer } from "../../shared/schemas/live-session-answer";
import type { LiveRoomRole } from "../../shared/live-session-policy";
import type { LiveRoomClientMessage } from "../../shared/schemas/live-session-room";
import { IconCheckmark } from "../components/icons";
import { Button } from "../ui/Button";
import { Menu, type MenuItem } from "../ui/Menu";
import { LiveAuthorName } from "./LiveAuthor";
import { LiveRemovedNote } from "./LiveRemovedNote";
import { liveParticipationMenuItems, liveRemoveMenuItem } from "./live-moderation-menu";

const ACCEPT = {
  on: { label: "Remove acceptance", tip: "This answer is no longer marked as the answer." },
  off: { label: "Accept answer", tip: "Marks this as the answer to your question. Everyone sees it first." },
};
export type LiveAnswerViewer = { role: LiveRoomRole; organizer?: boolean };
const UPVOTE_TIP = "Moves helpful answers up. Others don't see who voted.";

/** Moderator actions on one answer: remove or show it again, and the author's participation. */
function answerMenu(
  answer: LiveQuestionAnswer,
  questionId: string,
  viewer: LiveAnswerViewer,
  send: (message: LiveRoomClientMessage) => boolean,
  timeZone: string,
  onError: () => void,
): MenuItem[] {
  const hide = (hidden: boolean, reason?: LiveModerationReason) =>
    send({
      type: "question.answer.hide",
      questionId,
      answerId: answer.id,
      hidden,
      reason,
      expectedRevision: answer.revision,
    });
  const items: MenuItem[] = [
    answer.removal
      ? { id: "show", label: "Show answer", description: "Shows it to everyone again.", onSelect: () => hide(false) }
      : liveRemoveMenuItem("answer", (reason) => hide(true, reason), onError),
  ];
  items.push(
    ...liveParticipationMenuItems({
      item: { kind: "answer", questionId, answerId: answer.id },
      authorName: answer.authorName,
      actions: liveParticipationActions(viewer, {
        mine: answer.mine,
        staff: answer.authorStaff,
        restriction: answer.authorRestriction?.block ?? null,
      }),
      send,
      timeZone,
      onError,
    }),
  );
  return items;
}

/** One answer: its vote toggle, text and attribution, and the accept control in its own column. */
export function LiveQuestionAnswerRow({
  answer,
  questionId,
  viewer,
  canVote,
  canAccept,
  canModerate,
  disabled,
  accepting,
  onAccept,
  send,
  timeZone,
  onError,
}: {
  answer: LiveQuestionAnswer;
  questionId: string;
  viewer: LiveAnswerViewer;
  canVote: boolean;
  canAccept: boolean;
  canModerate: boolean;
  disabled: boolean;
  /** Another decision is waiting for the room, so this row's accept control rests. */
  accepting: "this" | "other" | null;
  onAccept: () => void;
  send: (message: LiveRoomClientMessage) => boolean;
  timeZone: string;
  onError: () => void;
}) {
  const accept = answer.acceptance ? ACCEPT.on : ACCEPT.off;
  const votes = `${formatNumber(answer.votes)} ${answer.votes === 1 ? "vote" : "votes"}`;
  const voteLabel = answer.mine ? `Your answer: ${votes}` : `Upvote answer: ${votes}`;
  return (
    <li class={`pk-live-answers__answer${answer.acceptance ? " pk-live-answers__answer--accepted" : ""}`}>
      <button
        type="button"
        class="pk-live-question__vote"
        aria-pressed={answer.votedByMe}
        aria-label={voteLabel}
        title={answer.mine ? undefined : UPVOTE_TIP}
        disabled={disabled || !canVote || answer.mine || answer.removal !== null}
        onClick={() =>
          send({ type: "question.answer.vote", questionId, answerId: answer.id, voted: !answer.votedByMe })
        }
      >
        <span aria-hidden="true">▲</span>
        <span>{formatNumber(answer.votes)}</span>
      </button>
      <div class="pk-live-answers__body">
        <LiveAuthorName name={answer.authorName} affiliation={answer.authorAffiliation} roles={answer.authorRoles} />
        <p class={answer.removal ? "pk-live-answers__text pk-live-removed-words" : "pk-live-answers__text"}>
          {answer.text}
        </p>
        {answer.acceptance ? (
          <p class="pk-live-answers__acceptance">
            <strong>Accepted answer</strong> ·{" "}
            {answer.acceptance.byName === null ? "by the question author" : `by ${answer.acceptance.byName}`}
          </p>
        ) : null}
        {answer.removal && answer.mine ? <LiveRemovedNote removal={answer.removal} /> : null}
        {answer.removal && !answer.mine ? (
          <p class="pk-live-answers__acceptance">
            Removed by {answer.removal.byName ?? "a moderator"}: {liveModerationReasonLabel(answer.removal.reason)}
          </p>
        ) : null}
      </div>
      <div class="pk-live-answers__tools">
        {canAccept && !answer.removal ? (
          <Button
            variant="secondary"
            icon
            aria-pressed={answer.acceptance !== null}
            aria-label={accepting === "this" ? `Retry: ${accept.label}` : accept.label}
            title={accept.tip}
            disabled={disabled || accepting === "other"}
            onClick={onAccept}
          >
            <IconCheckmark />
          </Button>
        ) : null}
        {canModerate ? (
          <Menu
            label={`Actions for answer from ${answer.authorName}`}
            align="end"
            items={answerMenu(answer, questionId, viewer, send, timeZone, onError)}
          />
        ) : null}
      </div>
    </li>
  );
}
