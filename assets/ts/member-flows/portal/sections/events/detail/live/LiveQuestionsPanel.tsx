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
import { LiveQuestionTransitions } from "../../../../../../live-session/LiveQuestionList";
import { LiveModerationDialogHost } from "../../../../../../live-session/LiveModerationDialog";
import { Avatar } from "../../../../../../ui/Avatar";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
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
      <StudioCreateAction label="Prepare question" disabled={disabled}>
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

const APPROVE = <path d="M3 8.5l3 3 7-7" />;
const ANSWERED = (
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.5 8.2l1.8 1.8 3.2-3.5" />
  </>
);
// Release starts a prepared question, so it takes the timers' Start.
const RELEASE = <path d="M5 3l8 5-8 5z" />;

/** A row's one-tap action as the studio draws it: an icon, named by its label and tooltip. */
function RowAction({
  label,
  primary = false,
  disabled,
  onClick,
  children,
}: {
  label: string;
  primary?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <Button
      icon
      variant={primary ? "primary" : "secondary"}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <StrokeIcon>{children}</StrokeIcon>
    </Button>
  );
}

/** One open question: its votes, asker, addressee and state, Approve or its outputs and Answered, and the menu. */
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
    { id: "edit", label: "Edit text", disabled, onSelect: onEdit },
  ];
  return (
    <StudioItemRow
      text={question.text}
      open={{ title: "Open question", onOpen }}
      presenceItem={pending ? item : undefined}
      summary={
        <>
          {pending ? <span class="pk-live-desk__question-state">Pending</span> : null}
          <span>▲ {formatNumber(question.votes)}</span>
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
            <RowAction label="Approve" primary disabled={disabled} onClick={() => moderate("approved")}>
              {APPROVE}
            </RowAction>
          </>
        ) : (
          <>
            <LiveLayerTargets targets={targets} subject="question" layer={layer} />
            <RowAction label="Mark answered" disabled={disabled} onClick={() => moderate("answered")}>
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
      open={{ title: "Edit question", onOpen: onEdit }}
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
          disabled={disabled}
          onClick={() => send({ type: "question.prepared.release", preparedId: question.id })}
        >
          {RELEASE}
        </RowAction>
      }
      menu={
        <Menu
          label="Prepared question actions"
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
 * action is in a row's menu; the row shows only the one used most.
 */
export function LiveQuestionsPanel({ targets, clock, send }: { targets: LiveTargets; clock: ClockZone; send: Send }) {
  const [inspected, setInspected] = useState<LiveQuestion | null>(null);
  const [editing, setEditing] = useState<LiveQuestion | null>(null);
  const [editingPrepared, setEditingPrepared] = useState<LivePreparedQuestion | null>(null);
  const open = openLiveQuestions(targets.state.questions);
  const prepared = waitingPreparedQuestions(targets.state.preparedQuestions);
  return (
    <div class="pk-live-desk__questions">
      <LiveModerationDialogHost />
      {open.length || prepared.length ? (
        <ol class="pk-studio-rows">
          {open.map((question) => (
            <OpenQuestionRow
              key={question.id}
              question={question}
              targets={targets}
              send={send}
              onOpen={() => setInspected(question)}
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
      {editingPrepared ? (
        <LivePreparedQuestionDialog
          question={editingPrepared}
          credits={targets.state.session.credits}
          send={send}
          onClose={() => setEditingPrepared(null)}
        />
      ) : null}
      {inspected ? (
        <Dialog
          open
          title="Audience question"
          meta={liveQuestionAskerName(inspected) ?? "Anonymous"}
          closeLabel="Close question"
          confirmLabel="Done"
          cancelLabel="Back to studio"
          onConfirm={() => setInspected(null)}
          onCancel={() => setInspected(null)}
        >
          <p>{inspected.text}</p>
          {inspected.originalText ? (
            <p>
              Asked as “{inspected.originalText}”
              {inspected.rewritten ? ` · edited by ${inspected.rewritten.operatorName}` : ""}
            </p>
          ) : null}
        </Dialog>
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
