import { liveQuestionAskerName } from "../../../../../../../shared/live-room-credits";
import type { LiveQuestion, LiveRoomClientMessage } from "../../../../../../../shared/schemas/live-session-room";
import { LiveAuthorProvider } from "../../../../../../live-session/LiveAuthor";
import { useLiveParticipation } from "../../../../../../live-session/LiveParticipationAlert";
import { LiveQuestionThread, type LiveAnswerReceipt } from "../../../../../../live-session/LiveQuestionThread";
import type { LiveRoomState } from "../../../../../../live-session/live-room-state";
import { useLiveQuestionThread } from "../../../../../../live-session/useLiveQuestionThread";
import { Dialog } from "../../../../../../ui/Dialog";
import "./LiveQuestionDialog.css";

/** What answering needs from the room's connection beside its state. */
export interface LiveAnswerConnection {
  /** The room is connected: answering does not wait for a broadcast in progress, as chat does not. */
  connected: boolean;
  /** The room's receipt or refusal for this operator's own answer or acceptance. */
  result: LiveAnswerReceipt | null;
}

/**
 * One audience question in full: its text, who asked it, and its answers on
 * the event app's own thread, where an operator reads, answers and accepts
 * as a moderator. The thread is open for as long as the dialog is.
 */
export function LiveQuestionDialog({
  question,
  state,
  answers,
  send,
  onClose,
}: {
  question: LiveQuestion;
  state: LiveRoomState;
  answers: LiveAnswerConnection;
  send: (message: LiveRoomClientMessage) => boolean;
  onClose: () => void;
}) {
  const restriction = useLiveParticipation(state.viewer.participation);
  useLiveQuestionThread(question.id, answers.connected, send);
  return (
    <Dialog
      open
      viewer
      title="Audience question"
      meta={liveQuestionAskerName(question) ?? "Anonymous"}
      closeLabel="Close question"
      confirmLabel="Close"
      onConfirm={onClose}
      onCancel={onClose}
    >
      <p class="pk-live-question-dialog__text">{question.text}</p>
      {question.originalText ? (
        <p>
          Asked as “{question.originalText}”
          {question.rewritten ? ` · edited by ${question.rewritten.operatorName}` : ""}
        </p>
      ) : null}
      <LiveAuthorProvider authors={state.authors} send={send}>
        <div class="pk-live-question-dialog__answers">
          <LiveQuestionThread
            question={question}
            expanded
            thread={state.thread?.questionId === question.id ? state.thread : null}
            disabled={!answers.connected}
            send={send}
            result={answers.result}
            viewer={state.viewer}
            restriction={restriction}
            timeZone={state.session.timeZone}
            eventName={state.session.eventName}
          />
        </div>
      </LiveAuthorProvider>
    </Dialog>
  );
}
