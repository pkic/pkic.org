import { useState } from "preact/hooks";
import type { ClockZone } from "../../../../../../../shared/event-clock";
import { format24HourClockInZone } from "../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../shared/format-number";
import { defaultLivePreparedQuestionWindow } from "../../../../../../../shared/live-session-policy";
import { liveQuestionAddresseeName } from "../../../../../../../shared/live-room-credits";
import type { LivePreparedQuestion } from "../../../../../../../shared/schemas/live-session-prepared-question";
import type { LiveQuestion, LiveRoomClientMessage } from "../../../../../../../shared/schemas/live-session-room";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { toast } from "../../../../ui";
import { Menu } from "../../../../../../ui/Menu";
import { LiveQuestionList, LiveQuestionTransitions } from "../../../../../../live-session/LiveQuestionList";
import { LiveAuthorProvider } from "../../../../../../live-session/LiveAuthor";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { LiveLayerTargets } from "./LiveLayerTargets";
import { LivePreparedQuestionDialog, LivePreparedQuestionWindowDialog } from "./LivePreparedQuestionDialogs";
import { StudioCreateAction } from "./studio/StudioCreateAction";
import { LiveQuestionRewrite } from "./LiveQuestionRewrite";
import type { LiveTargets } from "./live-output-targets";
import { livePresenceItem } from "./presence/live-presence";
import { LiveItemPresence } from "./presence/LivePresenceTag";
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

/**
 * Questions the room has not seen yet, under the open ones and drawn like
 * them: the text, then a meta line with when it comes in, and Release now
 * where an open question has Approve.
 */
function PreparedQuestionRows({
  targets,
  clock,
  send,
  onEdit,
}: {
  targets: LiveTargets;
  clock: ClockZone;
  send: (message: LiveRoomClientMessage) => boolean;
  onEdit: (question: LivePreparedQuestion) => void;
}) {
  const { state, disabled } = targets;
  const waiting = waitingPreparedQuestions(state.preparedQuestions);
  if (!waiting.length) return null;
  return (
    <ol class="pk-live-questions__list" aria-label="Prepared questions">
      {waiting.map((question) => {
        const addressee = liveQuestionAddresseeName(state.session.credits, question.addressedTo);
        return (
          <li key={question.id} class="pk-live-question">
            <div class="pk-live-question__body">
              <p>{question.text}</p>
              <div class="pk-live-question__meta">
                <span>Prepared</span>
                <span>Due {format24HourClockInZone(Date.parse(question.releaseAt), clock)}</span>
                {addressee ? <span>For {addressee}</span> : null}
              </div>
              <div class="pk-live-question__actions">
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => send({ type: "question.prepared.release", preparedId: question.id })}
                >
                  Release now
                </Button>
                <Menu
                  label="Prepared question actions"
                  items={[
                    { id: "edit", label: "Edit question", disabled, onSelect: () => onEdit(question) },
                    {
                      id: "delete",
                      label: "Delete question",
                      danger: true,
                      disabled,
                      separatorBefore: true,
                      onSelect: () => {
                        void (async () => {
                          const confirmed = await confirmAction({
                            title: "Delete this prepared question?",
                            body: `“${question.text}” will not come in.`,
                            confirmLabel: "Delete question",
                            tone: "danger",
                          });
                          if (confirmed) send({ type: "question.prepared.delete", preparedId: question.id });
                        })().catch((error: unknown) =>
                          toast(error instanceof Error ? error.message : "Could not complete the action.", "error"),
                        );
                      },
                    },
                  ]}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function LiveQuestionsPanel({
  targets,
  clock,
  send,
}: {
  targets: LiveTargets;
  clock: ClockZone;
  send: (message: LiveRoomClientMessage) => boolean;
}) {
  const [inspected, setInspected] = useState<LiveQuestion | null>(null);
  const [editing, setEditing] = useState<LiveQuestion | null>(null);
  const [editingPrepared, setEditingPrepared] = useState<LivePreparedQuestion | null>(null);
  const { disabled } = targets;
  const hasPrepared = targets.state.preparedQuestions.length > 0;
  return (
    <div class="pk-live-desk__questions">
      <LiveAuthorProvider authors={targets.state.authors} send={send}>
        <LiveQuestionList
          votesInline
          photos
          credits={targets.state.session.credits}
          questions={openLiveQuestions(targets.state.questions)}
          emptyText={hasPrepared ? "No open questions yet." : "No open questions."}
          showStatus={(question) => question.status === "pending"}
          actions={(question) => (
            <>
              {question.status === "pending" ? (
                <span
                  class="pk-live-desk__question-presence"
                  data-presence-item={livePresenceItem({ kind: "question", id: question.id })}
                >
                  <LiveItemPresence item={livePresenceItem({ kind: "question", id: question.id })} />
                  <Button
                    variant="primary"
                    disabled={disabled}
                    onClick={() =>
                      send({
                        type: "question.moderate",
                        questionId: question.id,
                        expectedRevision: question.revision,
                        status: "approved",
                      })
                    }
                  >
                    Approve
                  </Button>
                </span>
              ) : (
                <LiveLayerTargets targets={targets} subject="question" layer={{ kind: "question", id: question.id }} />
              )}
              {question.status === "approved" ? (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    send({
                      type: "question.moderate",
                      questionId: question.id,
                      expectedRevision: question.revision,
                      status: "answered",
                    })
                  }
                >
                  Answered
                </Button>
              ) : null}
              <LiveQuestionTransitions
                question={question}
                role="operator"
                disabled={disabled}
                menuLabel="Question actions"
                additionalActions={[
                  { id: "open", label: "Open question", onSelect: () => setInspected(question) },
                  { id: "edit", label: "Edit text", disabled, onSelect: () => setEditing(question) },
                ]}
                onMove={(next) =>
                  send({
                    type: "question.moderate",
                    questionId: question.id,
                    expectedRevision: question.revision,
                    status: next,
                  })
                }
              />
            </>
          )}
        />
      </LiveAuthorProvider>
      <PreparedQuestionRows targets={targets} clock={clock} send={send} onEdit={setEditingPrepared} />
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
          meta={inspected.authorName ?? "Anonymous"}
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
