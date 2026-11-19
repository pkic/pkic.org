import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { ClockZone } from "../../../../../../../shared/event-clock";
import { format24HourClockInZone } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import { liveQuestionAddresseeName, liveQuestionAskerName } from "../../../../../../../shared/live-room-credits";
import type { LiveModerationReason } from "../../../../../../../shared/live-moderation-policy";
import {
  defaultLivePreparedQuestionWindow,
  type LiveQuestionStatus,
} from "../../../../../../../shared/live-session-policy";
import type { LivePreparedQuestion } from "../../../../../../../shared/schemas/live-session-prepared-question";
import type { LiveQuestion, LiveRoomClientMessage } from "../../../../../../../shared/schemas/live-session-room";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { TabList } from "../../../../../../ui/TabList";
import { LiveQuestionTransitions } from "../../../../../../live-session/LiveQuestionList";
import { liveRemovalNote } from "../../../../../../live-session/LiveRemovedPost";
import { liveAnswerCountLabel } from "../../../../../../live-session/LiveQuestionThread";
import { LiveModerationDialogHost } from "../../../../../../live-session/LiveModerationDialog";
import { Avatar } from "../../../../../../ui/Avatar";
import { Button } from "../../../../../../ui/Button";
import { StrokeIcon } from "../../../../../../ui/MediaIcons";
import { Menu } from "../../../../../../ui/Menu";
import { toast } from "../../../../ui";
import { LiveLayerTargets } from "./LiveLayerTargets";
import {
  LiveScreenTrigger,
  NO_LIVE_SCREENS,
  liveScreenItems,
  liveScreens,
  liveScreensTitle,
  withScreenItems,
} from "./LiveRowMenu";
import { LivePreparedQuestionDialog, LivePreparedQuestionWindowDialog } from "./LivePreparedQuestionDialogs";
import { LiveQuestionDialog, type LiveAnswerConnection } from "./LiveQuestionDialog";
import { LiveQuestionRewrite } from "./LiveQuestionRewrite";
import type { LiveTargets } from "./live-output-targets";
import { livePresenceItem } from "./presence/live-presence";
import { LiveItemPresence } from "./presence/LivePresenceTag";
import { StudioCreateAction } from "./studio/StudioCreateAction";
import { StudioItemRow } from "./studio/StudioItemRow";
import "./LiveQuestionsPanel.css";

/** Open questions, most voted first, with moderation and outputs; answered and hidden ones leave the list. */
export function openLiveQuestions(questions: readonly LiveQuestion[]): LiveQuestion[] {
  return questions.filter((question) => question.status === "pending" || question.status === "approved");
}

/** Questions that left the open ones and can still come back: answered ones to reopen, hidden ones to show again. */
type ClosedStatus = "answered" | "hidden";

/** The closed questions of one kind; one its author withdrew is gone for good. */
export function closedLiveQuestions(questions: readonly LiveQuestion[], status: ClosedStatus): LiveQuestion[] {
  return questions.filter((question) => question.status === status && !question.withdrawn);
}

/** The Questions panel's header: how many are open and waiting, and the "+" that prepares one. */
export function LiveQuestionsHeader({
  targets,
  send,
}: {
  targets: LiveTargets;
  send: (message: LiveRoomClientMessage) => boolean;
}) {
  const { state, disabled } = targets;
  const waiting = state.preparedQuestions.length;
  return (
    <>
      <span class="pk-studio-panel__meta">
        {formatNumber(openLiveQuestions(state.questions).length)} open
        {waiting ? ` · ${formatNumber(waiting)} prepared` : ""}
      </span>
      <StudioCreateAction
        label="Prepare question"
        hint="Write a question ahead. It comes in at the time you set, or when you release it."
        disabled={disabled}
      >
        {(close) => (
          <LivePreparedQuestionDialog question={null} credits={state.session.credits} send={send} onClose={close} />
        )}
      </StudioCreateAction>
    </>
  );
}

/** The release-times dialog for the panel's menu, opening on the window the room keeps or the session's default. */
export function LivePreparedQuestionTimes({
  targets,
  clock,
  send,
  onClose,
}: {
  targets: LiveTargets;
  clock: ClockZone;
  send: (message: LiveRoomClientMessage) => boolean;
  onClose: () => void;
}) {
  const { session, preparedQuestionWindow } = targets.state;
  return (
    <LivePreparedQuestionWindowDialog
      window={preparedQuestionWindow ?? defaultLivePreparedQuestionWindow(session.startAt, session.endAt)}
      session={session}
      clock={clock}
      send={send}
      onClose={onClose}
    />
  );
}

/** Prepared questions in the order they come in. */
export function waitingPreparedQuestions(questions: readonly LivePreparedQuestion[]): LivePreparedQuestion[] {
  return [...questions].sort((left, right) => Date.parse(left.releaseAt) - Date.parse(right.releaseAt));
}

type Send = (message: LiveRoomClientMessage) => boolean;

/** The panel's tabs: the open and prepared questions, the answered ones, and the ones a moderator hid. */
const QUESTION_VIEWS = ["open", "answered", "hidden"] as const;
type QuestionView = (typeof QUESTION_VIEWS)[number];
const CLOSED_VIEWS = [
  { id: "answered", label: "Answered", empty: "No answered questions." },
  { id: "hidden", label: "Hidden", empty: "No hidden questions." },
] as const satisfies ReadonlyArray<{ id: ClosedStatus; label: string; empty: string }>;

const APPROVE = <path d="M3 8.5l3 3 7-7" />;
const ANSWERED = (
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.5 8.2l1.8 1.8 3.2-3.5" />
  </>
);
const REOPEN = <path d="M4.5 3.5 2 6l2.5 2.5M2 6h7.5a3.5 3.5 0 0 1 0 7H6" />;
// Release starts a prepared question, so it takes the timers' Start.
const RELEASE = <path d="M5 3l8 5-8 5z" />;

/** A row's one-tap action as the studio draws it: an icon, named by its label and tooltip. */
function RowAction({
  label,
  hint,
  primary = false,
  quiet = false,
  disabled,
  onClick,
  children,
}: {
  label: string;
  /** What the action does to the question: the second line of its tooltip. */
  hint: string;
  primary?: boolean;
  /** An action that ends something, such as Mark answered, recedes so a slip of the hand is less likely. */
  quiet?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <Button
      icon
      variant={primary ? "primary" : quiet ? "ghost" : "secondary"}
      aria-label={label}
      title={`${label}\n${hint}`}
      disabled={disabled}
      onClick={onClick}
    >
      <StrokeIcon>{children}</StrokeIcon>
    </Button>
  );
}

/** One open question: its votes, answers, asker, addressee and state, Approve or its outputs and Answered, and the menu. */
function OpenQuestionRow({
  question,
  targets,
  send,
  onOpen,
  onEdit,
}: {
  question: LiveQuestion;
  targets: LiveTargets;
  send: Send;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const { state, disabled } = targets;
  const addressee = liveQuestionAddresseeName(state.session.credits, question.addressedTo);
  const asker = liveQuestionAskerName(question);
  const moderate = (status: LiveQuestionStatus, reason?: LiveModerationReason) =>
    send({ type: "question.moderate", questionId: question.id, expectedRevision: question.revision, status, reason });
  const pending = question.status === "pending";
  const item = livePresenceItem({ kind: "question", id: question.id });
  const layer = { kind: "question", id: question.id } as const;
  // A pending question goes nowhere yet, so its menu has no screens.
  const screens = pending ? NO_LIVE_SCREENS : liveScreens(targets, layer);
  const actions = [
    { id: "open", label: "Open question", onSelect: onOpen },
    {
      id: "edit",
      label: "Edit text",
      tooltip: "Fix its wording before it goes on air. The question keeps what was asked.",
      disabled,
      onSelect: onEdit,
    },
  ];
  return (
    <StudioItemRow
      text={question.text}
      open={{ title: "Open question\nRead it in full, with who asked it and its answers.", onOpen }}
      presenceItem={pending ? item : undefined}
      summary={
        <>
          {pending ? <span class="pk-live-desk__question-state">Pending</span> : null}
          <span>▲ {formatNumber(question.votes)}</span>
          {question.answerCount ? (
            <span>
              {liveAnswerCountLabel(question.answerCount)}
              {question.acceptedAnswer ? " · 1 accepted" : ""}
            </span>
          ) : null}
          {question.authorPhotoUrl && asker ? (
            <Avatar name={asker} src={question.authorPhotoUrl} size="sm" alt="" />
          ) : null}
          <span>{[addressee ? `For ${addressee}` : null, asker ?? "Anonymous"].filter(Boolean).join(" · ")}</span>
        </>
      }
      actions={
        pending ? (
          <>
            <LiveItemPresence item={item} />
            <RowAction
              label="Approve"
              hint="Open it for votes. It can then go to Preview or on air."
              primary
              disabled={disabled}
              onClick={() => moderate("approved")}
            >
              {APPROVE}
            </RowAction>
          </>
        ) : (
          <>
            <LiveLayerTargets targets={targets} subject="question" layer={layer} />
            <RowAction
              label="Mark answered"
              hint="Move it to the Answered tab. You can reopen it from there."
              quiet
              disabled={disabled}
              onClick={() => moderate("answered")}
            >
              {ANSWERED}
            </RowAction>
          </>
        )
      }
      menu={
        <LiveQuestionTransitions
          question={question}
          role="operator"
          disabled={disabled}
          menuLabel="Question actions"
          menuTrigger={<LiveScreenTrigger screens={screens} />}
          menuTitle={liveScreensTitle(screens)}
          additionalActions={pending ? actions : withScreenItems(liveScreenItems(targets, layer), actions)}
          onMove={moderate}
        />
      }
    />
  );
}

/** How each kind of closed question comes back, as its row's one action says it. */
const CLOSED_QUESTION_RETURN: Record<ClosedStatus, { label: string; hint: string }> = {
  answered: { label: "Reopen", hint: "Put it back with the open questions." },
  hidden: { label: "Show question", hint: "Show it to everyone again, with the open questions." },
};

/** One answered or hidden question: its votes and asker, or why it was hidden, its way back, and the menu. */
function ClosedQuestionRow({
  question,
  targets,
  send,
  onOpen,
}: {
  question: LiveQuestion;
  targets: LiveTargets;
  send: Send;
  onOpen: () => void;
}) {
  const { disabled } = targets;
  const asker = liveQuestionAskerName(question);
  const back = CLOSED_QUESTION_RETURN[question.status === "hidden" ? "hidden" : "answered"];
  const moderate = (status: LiveQuestionStatus, reason?: LiveModerationReason) =>
    send({ type: "question.moderate", questionId: question.id, expectedRevision: question.revision, status, reason });
  return (
    <StudioItemRow
      text={question.text}
      open={{ title: "Open question\nRead it in full, with who asked it and its answers.", onOpen }}
      summary={
        <>
          <span>▲ {formatNumber(question.votes)}</span>
          <span>{asker ?? "Anonymous"}</span>
          {question.removal ? <span>{liveRemovalNote(question.removal)}</span> : null}
        </>
      }
      actions={
        <RowAction label={back.label} hint={back.hint} disabled={disabled} onClick={() => moderate("approved")}>
          {REOPEN}
        </RowAction>
      }
      menu={
        <LiveQuestionTransitions
          question={question}
          role="operator"
          disabled={disabled}
          menuLabel="Question actions"
          additionalActions={[{ id: "open", label: "Open question", onSelect: onOpen }]}
          onMove={moderate}
        />
      }
    />
  );
}

/** One prepared question: when it comes in and for whom, Release now, and Edit or Delete in the menu. */
function PreparedQuestionRow({
  question,
  targets,
  clock,
  send,
  onEdit,
}: {
  question: LivePreparedQuestion;
  targets: LiveTargets;
  clock: ClockZone;
  send: Send;
  onEdit: () => void;
}) {
  const { state, disabled } = targets;
  const addressee = liveQuestionAddresseeName(state.session.credits, question.addressedTo);
  const remove = async () => {
    const confirmed = await confirmAction({
      title: "Delete this prepared question?",
      body: `“${question.text}” will not come in.`,
      confirmLabel: "Delete question",
      tone: "danger",
    });
    if (confirmed) send({ type: "question.prepared.delete", preparedId: question.id });
  };
  return (
    <StudioItemRow
      text={question.text}
      open={{ title: "Edit prepared question\nChange its text, who it is for, or when it comes in.", onOpen: onEdit }}
      summary={
        <>
          <span class="pk-live-desk__question-state">Prepared</span>
          <span>
            {[
              `Due ${format24HourClockInZone(Date.parse(question.releaseAt), clock)}`,
              addressee ? `For ${addressee}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </>
      }
      actions={
        <RowAction
          label="Release now"
          hint="Bring this prepared question in now, ahead of its time."
          disabled={disabled}
          onClick={() => send({ type: "question.prepared.release", preparedId: question.id })}
        >
          {RELEASE}
        </RowAction>
      }
      menu={
        <Menu
          label="Prepared question actions"
          title={"Prepared question actions\nRelease it now, edit it or delete it."}
          align="end"
          items={[
            {
              id: "release",
              label: "Release now",
              disabled,
              onSelect: () => send({ type: "question.prepared.release", preparedId: question.id }),
            },
            { id: "edit", label: "Edit question", disabled, onSelect: onEdit },
            {
              id: "delete",
              label: "Delete question",
              danger: true,
              disabled,
              separatorBefore: true,
              onSelect: () =>
                void remove().catch((error: unknown) =>
                  toast(error instanceof Error ? error.message : "Could not complete the action.", "error"),
                ),
            },
          ]}
        />
      }
    />
  );
}

/**
 * The session's questions as compact rows, like the Time and Polls panels:
 * open ones first, then prepared ones in the order they come in. Every
 * action is in a row's menu; the row shows only the one used most. Answered
 * and hidden questions each have a tab of their own, every row with its way
 * back; the tab in view follows the address, as the chat's does.
 */
export function LiveQuestionsPanel({
  targets,
  clock,
  send,
  answers,
  opensOn = "open",
}: {
  targets: LiveTargets;
  clock: ClockZone;
  send: Send;
  answers: LiveAnswerConnection;
  /** The tab in view until the address names one. */
  opensOn?: QuestionView;
}) {
  // The open question is read from the room each time, so its answers and their count stay current.
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const inspected = targets.state.questions.find((question) => question.id === inspectedId) ?? null;
  const [editing, setEditing] = useState<LiveQuestion | null>(null);
  const [editingPrepared, setEditingPrepared] = useState<LivePreparedQuestion | null>(null);
  const open = openLiveQuestions(targets.state.questions);
  const prepared = waitingPreparedQuestions(targets.state.preparedQuestions);
  const closed = {
    answered: closedLiveQuestions(targets.state.questions, "answered"),
    hidden: closedLiveQuestions(targets.state.questions, "hidden"),
  };
  const [view, setView] = useHashQueryParam("questions", opensOn, QUESTION_VIEWS);
  return (
    <div class="pk-live-desk__questions">
      <LiveModerationDialogHost />
      <TabList
        label="Questions"
        idPrefix="studio-questions"
        activeId={view}
        onSelect={(id) => setView(id as QuestionView)}
        items={[
          { id: "open", panelId: "studio-questions-panel-open", label: "Open" },
          ...CLOSED_VIEWS.map(({ id, label }) => ({
            id,
            panelId: `studio-questions-panel-${id}`,
            label: closed[id].length ? `${label} · ${formatNumber(closed[id].length)}` : label,
          })),
        ]}
      />
      <div
        id="studio-questions-panel-open"
        role="tabpanel"
        aria-labelledby="studio-questions-open"
        hidden={view !== "open"}
      >
        {open.length || prepared.length ? (
          <ol class="pk-studio-rows">
            {open.map((question) => (
              <OpenQuestionRow
                key={question.id}
                question={question}
                targets={targets}
                send={send}
                onOpen={() => setInspectedId(question.id)}
                onEdit={() => setEditing(question)}
              />
            ))}
            {prepared.map((question) => (
              <PreparedQuestionRow
                key={question.id}
                question={question}
                targets={targets}
                clock={clock}
                send={send}
                onEdit={() => setEditingPrepared(question)}
              />
            ))}
          </ol>
        ) : (
          <p class="pk-live-questions__empty">No open questions.</p>
        )}
      </div>
      {CLOSED_VIEWS.map(({ id, empty }) => (
        <div
          key={id}
          id={`studio-questions-panel-${id}`}
          role="tabpanel"
          aria-labelledby={`studio-questions-${id}`}
          hidden={view !== id}
        >
          {closed[id].length ? (
            <ol class="pk-studio-rows">
              {closed[id].map((question) => (
                <ClosedQuestionRow
                  key={question.id}
                  question={question}
                  targets={targets}
                  send={send}
                  onOpen={() => setInspectedId(question.id)}
                />
              ))}
            </ol>
          ) : (
            <p class="pk-live-questions__empty">{empty}</p>
          )}
        </div>
      ))}
      {editingPrepared ? (
        <LivePreparedQuestionDialog
          question={editingPrepared}
          credits={targets.state.session.credits}
          send={send}
          onClose={() => setEditingPrepared(null)}
        />
      ) : null}
      {inspected ? (
        <LiveQuestionDialog
          question={inspected}
          state={targets.state}
          answers={answers}
          send={send}
          onClose={() => setInspectedId(null)}
        />
      ) : null}
      {editing ? (
        <LiveQuestionRewrite
          question={editing}
          onSave={(text) => send({ type: "question.rewrite", questionId: editing.id, text })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
