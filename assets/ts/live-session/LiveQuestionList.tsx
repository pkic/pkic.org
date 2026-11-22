import type { ComponentChildren } from "preact";
import type { LiveModerationReason } from "../../shared/live-moderation-policy";
import { liveQuestionTransitions, type LiveQuestionStatus, type LiveRoomRole } from "../../shared/live-session-policy";
import { formatNumber } from "../../shared/format-number";
import { liveQuestionAddresseeName } from "../../shared/live-room-credits";
import type { LiveCredit, LiveQuestion } from "../../shared/schemas/live-session-room";
import { Menu, type MenuItem } from "../ui/Menu";
import { Badge, type BadgeTone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Avatar } from "../ui/Avatar";
import { LiveAuthorName } from "./LiveAuthor";
import { LiveModerationDialogHost } from "./LiveModerationDialog";
import { liveRemoveMenuItem } from "./live-moderation-menu";
import { LiveRemovedPost, liveRemovalNote } from "./LiveRemovedPost";
import "./SessionQuestions.css";

const STATUS: Record<LiveQuestionStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: "Awaiting moderation", tone: "warn" },
  approved: { label: "Open", tone: "info" },
  answered: { label: "Discussed on stage", tone: "ok" },
  hidden: { label: "Hidden", tone: "neutral" },
};

const TRANSITION_LABEL: Record<LiveQuestionStatus, string> = {
  pending: "Return to queue",
  approved: "Approve",
  answered: "Mark discussed",
  hidden: "Hide question…",
};

/** A move's name: coming back to the open questions is Reopen after an answer and Show after a moderator hid it. */
function returnLabel(from: LiveQuestionStatus, to: LiveQuestionStatus): string {
  if (to === "approved" && from === "answered") return "Reopen";
  if (to === "approved" && from === "hidden") return "Show question";
  return TRANSITION_LABEL[to];
}

/** The status actions a role may take on a question, from the shared moderation policy. */
export function LiveQuestionTransitions({
  question,
  role,
  disabled,
  onMove,
  menuLabel,
  menuTrigger,
  menuTitle,
  additionalActions = [],
}: {
  menuLabel?: string;
  /** The menu trigger's content and tooltip, when the row marks something on it; a ⋯ otherwise. */
  menuTrigger?: ComponentChildren;
  menuTitle?: string;
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
        title={menuTitle}
        items={[
          ...additionalActions,
          ...transitions.map((status) =>
            status === "hidden"
              ? { ...remove, disabled }
              : {
                  id: status,
                  label: returnLabel(question.status, status),
                  disabled,
                  onSelect: () => onMove(status),
                },
          ),
        ]}
      >
        {menuTrigger}
      </Menu>
    );
  if (!transitions.length) return null;
  return (
    <>
      {transitions.map((status) => (
        <Button
          key={status}
          variant={status === "hidden" ? "danger-quiet" : status === "approved" ? "primary" : "secondary"}
          disabled={disabled}
          title={status === "hidden" ? remove.tooltip : undefined}
          onClick={() => (status === "hidden" ? remove.onSelect?.() : onMove(status))}
        >
          {returnLabel(question.status, status)}
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
  photos = false,
  credits = [],
  lead,
}: {
  questions: readonly LiveQuestion[];
  /** Something listed before the questions as one of them, such as the session's poll. */
  lead?: ComponentChildren;
  /** The session's credits, which name the person a question is for. */
  credits?: readonly LiveCredit[];
  compact?: boolean;
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
  const leading = lead ? (
    <li class="pk-live-question" data-lead>
      {lead}
    </li>
  ) : null;
  if (!questions.length)
    return (
      <>
        {leading ? <ol class="pk-live-questions__list">{leading}</ol> : null}
        <p class="pk-live-questions__empty">{emptyText}</p>
      </>
    );
  const addressee = (question: LiveQuestion) => liveQuestionAddresseeName(credits, question.addressedTo);
  return (
    <>
      <LiveModerationDialogHost />
      <ol class="pk-live-questions__list">
        {leading}
        {questions.map((question) => (
          <li key={question.id} class="pk-live-question" data-removed={question.removal ? "" : undefined}>
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

            <div class="pk-live-question__body">
              {question.removal ? (
                <LiveRemovedPost note={liveRemovalNote(question.removal)}>
                  <QuestionWords question={question} compact={compact} />
                </LiveRemovedPost>
              ) : (
                <QuestionWords question={question} compact={compact} />
              )}
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
                {addressee(question) ? <span>For {addressee(question)}</span> : null}
                {question.prepared ? <span>Prepared</span> : null}
                {question.anonymous && question.authorName ? <span>Anonymous to attendees</span> : null}
                {question.withdrawn ? (
                  <span>Withdrawn</span>
                ) : showStatus(question) ? (
                  <Badge tone={STATUS[question.status].tone}>{STATUS[question.status].label}</Badge>
                ) : null}
                {question.moderated && !compact ? <span>by {question.moderated.operatorName}</span> : null}
              </div>
              {actions ? <div class="pk-live-question__actions">{actions(question)}</div> : null}
              {thread?.(question)}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

/** A question's words, and what the asker first wrote when a moderator edited them. */
function QuestionWords({ question, compact }: { question: LiveQuestion; compact?: boolean }) {
  return (
    <>
      <p class={compact ? "pk-live-question__excerpt" : undefined}>{question.text}</p>
      {!compact && question.originalText !== null ? (
        <p class="pk-live-question__original">
          Asked as “{question.originalText}”
          {question.rewritten ? ` · edited by ${question.rewritten.operatorName}` : ""}
        </p>
      ) : null}
    </>
  );
}
