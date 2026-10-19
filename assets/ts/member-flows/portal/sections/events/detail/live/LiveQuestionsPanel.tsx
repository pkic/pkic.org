import { useState } from "preact/hooks";
import type { LiveQuestion, LiveRoomClientMessage } from "../../../../../../../shared/schemas/live-session-room";
import { LiveQuestionList, LiveQuestionTransitions } from "../../../../../../live-session/LiveQuestionList";
import { LiveAuthorProvider } from "../../../../../../live-session/LiveAuthor";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { LiveLayerTargets } from "./LiveLayerTargets";
import { LiveQuestionRewrite } from "./LiveQuestionRewrite";
import type { LiveTargets } from "./live-output-targets";
import { livePresenceItem } from "./presence/live-presence";
import { LiveItemPresence } from "./presence/LivePresenceTag";
import "./LiveQuestionsPanel.css";

/** Open questions, most voted first, with moderation and outputs; answered and hidden ones leave the list. */
export function openLiveQuestions(questions: readonly LiveQuestion[]): LiveQuestion[] {
  return questions.filter((question) => question.status === "pending" || question.status === "approved");
}

export function LiveQuestionsPanel({
  targets,
  send,
}: {
  targets: LiveTargets;
  send: (message: LiveRoomClientMessage) => boolean;
}) {
  const [inspected, setInspected] = useState<LiveQuestion | null>(null);
  const [editing, setEditing] = useState<LiveQuestion | null>(null);
  const { disabled } = targets;
  return (
    <div class="pk-live-desk__questions">
      <LiveAuthorProvider authors={targets.state.authors} send={send}>
        <LiveQuestionList
          votesInline
          photos
          questions={openLiveQuestions(targets.state.questions)}
          emptyText="No open questions."
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
