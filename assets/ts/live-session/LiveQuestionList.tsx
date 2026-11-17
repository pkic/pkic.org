import type { ComponentChildren } from "preact";
import { liveModerationReasonLabel, type LiveModerationReason } from "../../shared/live-moderation-policy";
import { liveQuestionTransitions, type LiveQuestionStatus, type LiveRoomRole } from "../../shared/live-session-policy";
import { formatNumber } from "../../shared/format-number";
import type { LiveQuestion } from "../../shared/schemas/live-session-room";
import { Menu, type MenuItem } from "../ui/Menu";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Avatar } from "../ui/Avatar";
import { LiveAuthorName } from "./LiveAuthor";
import { LiveModerationDialogHost } from "./LiveModerationDialog";
import { liveRemoveMenuItem } from "./live-moderation-menu";
import { LiveRemovedNote } from "./LiveRemovedNote";
import "./SessionQuestions.css";

const STATUS: Record<LiveQuestionStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: "Awaiting moderation", tone: "warn" },
  approved: { label: "Open", tone: "info" },
  answered: { label: "Answered", tone: "ok" },
  hidden: { label: "Hidden", tone: "neutral" },
};

const TRANSITION_LABEL: Record<LiveQuestionStatus, string> = {
  pending: "Return to queue",
  approved: "Approve",
  answered: "Mark answered",
  hidden: "Remove question…",
};

/** The status actions a role may take on a question, from the shared moderation policy. */
export function LiveQuestionTransitions({
  question,
  role,
  disabled,
  onMove,
  menuLabel,
  additionalActions = [],
}: {
  menuLabel?: string;
  additionalActions?: readonly MenuItem[];
  question: LiveQuestion;
  role: LiveRoomRole;
  disabled: boolean;
  /** Removing carries the reason the moderator chose; the other moves carry none. */
  onMove: (status: LiveQuestionStatus, reason?: LiveModerationReason) => void;
}) {
  if (question.withdrawn) return null;
  const transitions = liveQuestionTransitions(role, question.status);
  const remove = liveRemoveMenuItem(
    "question",
    (reason) => onMove("hidden", reason),
    () => undefined,
  );
  if (menuLabel)
    return (
      <Menu
        label={menuLabel}
        items={[
          ...additionalActions,
          ...transitions.map((status) =>
            status === "hidden"
              ? { ...remove, disabled }
              : {
                  id: status,
                  label: question.status === "answered" && status === "approved" ? "Reopen" : TRANSITION_LABEL[status],
                  disabled,
                  onSelect: () => onMove(status),
                },
          ),
        ]}
      />
    );
  if (!transitions.length) return null;
  return (
    <>
      {transitions.map((status) => (
        <Button
          key={status}
          variant={status === "hidden" ? "danger-quiet" : status === "approved" ? "primary" : "secondary"}
          disabled={disabled}
          title={status === "hidden" ? remove.description : undefined}
          onClick={() => (status === "hidden" ? remove.onSelect?.() : onMove(status))}
        >
          {question.status === "answered" && status === "approved" ? "Reopen" : TRANSITION_LABEL[status]}
        </Button>
      ))}
    </>
  );
}

/** One room's questions as its viewer may see them, with the votes and actions the caller allows. */
export function LiveQuestionList({
  questions,
  emptyText,
  showStatus,
  onVote,
  actions,
  thread,
  compact = false,
  votesInline = false,
  photos = false,
}: {
  questions: readonly LiveQuestion[];
  compact?: boolean;
  votesInline?: boolean;
  /** Shows the asker's photo beside their name, when they asked by name and have one. */
  photos?: boolean;
  emptyText: string;
  /** Moderators see every status; attendees see a status only on their own questions. */
  showStatus: (question: LiveQuestion) => boolean;
  /** Present while the viewer may vote. */
  onVote?: (question: LiveQuestion) => void;
  actions?: (question: LiveQuestion) => ComponentChildren;
  thread?: (question: LiveQuestion) => ComponentChildren;
}) {
  if (!questions.length) return <p class="pk-live-questions__empty">{emptyText}</p>;
  return (
    <>
      <LiveModerationDialogHost />
      <ol class="pk-live-questions__list">
        {questions.map((question) => (
          <li key={question.id} class="pk-live-question">
            {!votesInline ? (
              <button
                type="button"
                class="pk-live-question__vote"
                aria-pressed={question.votedByMe}
                aria-label={`${question.votedByMe ? "Remove your vote" : "Vote"}: ${formatNumber(question.votes)} ${question.votes === 1 ? "vote" : "votes"}`}
                disabled={!onVote || question.status !== "approved"}
                onClick={() => onVote?.(question)}
              >
                <span aria-hidden="true">▲</span>
                <span>{formatNumber(question.votes)}</span>
              </button>
            ) : null}

            <div class="pk-live-question__body">
              <p
                class={
                  [compact ? "pk-live-question__excerpt" : null, question.removal ? "pk-live-removed-words" : null]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                {question.text}
              </p>
              {!compact && question.originalText !== null ? (
                <p class="pk-live-question__original">
                  Asked as “{question.originalText}”
                  {question.rewritten ? ` · edited by ${question.rewritten.operatorName}` : ""}
                </p>
              ) : null}
              <div class="pk-live-question__meta">
                {photos && question.authorPhotoUrl && question.authorName ? (
                  <Avatar name={question.authorName} src={question.authorPhotoUrl} size="sm" alt="" />
                ) : null}
                <LiveAuthorName
                  class="pk-live-question__author"
                  name={question.authorName ?? "Anonymous"}
                  handle={question.authorHandle}
                  affiliation={question.authorAffiliation}
                  roles={question.authorRoles}
                />
                {votesInline ? <span>{formatNumber(question.votes)} votes</span> : null}
                {question.anonymous && question.authorName ? <span>Anonymous to attendees</span> : null}
                {question.withdrawn ? (
                  <span>Withdrawn</span>
                ) : showStatus(question) ? (
                  <Badge tone={STATUS[question.status].tone}>{STATUS[question.status].label}</Badge>
                ) : null}
                {question.moderated && !compact ? <span>by {question.moderated.operatorName}</span> : null}
                {question.removal && !question.mine ? (
                  <span>
                    Removed by {question.removal.byName ?? "a moderator"}:{" "}
                    {liveModerationReasonLabel(question.removal.reason)}
                  </span>
                ) : null}
              </div>
              {question.removal && question.mine ? <LiveRemovedNote removal={question.removal} /> : null}
              {actions ? <div class="pk-live-question__actions">{actions(question)}</div> : null}
              {thread?.(question)}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
