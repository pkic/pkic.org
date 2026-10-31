import { useEffect, useId, useState } from "preact/hooks";
import {
  liveQuestionRewriteSchema,
  type LiveQuestion,
  type LiveRoomClientMessage,
  type LiveRoomServerMessage,
} from "../../shared/schemas/live-session-room";
import { confirmAction } from "../components/ConfirmDialog";
import { useContractForm } from "../hooks/useContractForm";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { FieldStatus } from "../ui/FieldStatus";
import { Menu } from "../ui/Menu";
import { Textarea } from "../ui/TextControl";

type Change = Extract<LiveRoomClientMessage, { type: "question.edit" | "question.withdraw" }>;
type Result = Extract<LiveRoomServerMessage, { type: "question.updated" | "room.refused" }>;

/** The asker's own actions: edit before review or permanently withdraw, waiting for the room's receipt. */
export function LiveOwnQuestionActions({
  question,
  disabled,
  send,
  result,
}: {
  question: LiveQuestion;
  disabled: boolean;
  send: (message: LiveRoomClientMessage) => boolean;
  result: Result | null;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(question.text);
  const [basis, setBasis] = useState(question.revision);
  const [pending, setPending] = useState<Change | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const form = useContractForm(liveQuestionRewriteSchema, { text });
  useEffect(() => {
    if (!pending || result?.operationId !== pending.operationId) return;
    if (result.type === "question.updated") {
      if (result.questionId !== question.id) return;
      setEditing(false);
      setNotice(null);
    } else setNotice(result.message);
    setPending(null);
  }, [pending, result, question.id]);

  function transmit(request: Change) {
    if (!send(request)) {
      setNotice("The room is reconnecting. Please try again in a moment.");
      return;
    }
    setPending(request);
    setNotice("Waiting for confirmation. You can retry the same change if the connection was interrupted.");
  }
  function save() {
    if (pending) return transmit(pending);
    const checked = form.submit();
    if (!checked.data) return setNotice(checked.formMessage);
    transmit({
      type: "question.edit",
      questionId: question.id,
      operationId: crypto.randomUUID(),
      expectedRevision: basis,
      ...checked.data,
    });
  }
  async function withdraw() {
    if (
      !(await confirmAction({
        title: "Withdraw question?",
        body: "Your question will leave the attendee list and live displays.",
        consequences: ["You cannot bring this question back."],
        confirmLabel: "Withdraw question",
        tone: "danger",
      }))
    )
      return;
    transmit({
      type: "question.withdraw",
      questionId: question.id,
      operationId: crypto.randomUUID(),
      expectedRevision: question.revision,
    });
  }
  if (!question.mine || (question.withdrawn && !pending && !notice && !editing)) return null;
  return (
    <>
      <div class="pk-cluster">
        {!question.withdrawn ? (
          <Menu
            label="Your question actions"
            items={[
              {
                id: "edit",
                label: "Edit question",
                disabled: disabled || pending !== null || !question.canEdit,
                onSelect: () => {
                  setText(question.text);
                  setBasis(question.revision);
                  setNotice(null);
                  form.reset();
                  setEditing(true);
                },
              },
              {
                id: "withdraw",
                label: "Withdraw question",
                danger: true,
                disabled: disabled || pending !== null,
                onSelect: () => {
                  void withdraw();
                },
              },
            ]}
          />
        ) : null}
        {pending && !editing ? (
          <Button variant="secondary" disabled={disabled} onClick={() => transmit(pending)}>
            {pending.type === "question.withdraw" ? "Retry withdrawal" : "Retry changes"}
          </Button>
        ) : null}
      </div>
      {!editing && notice ? <FieldStatus id={`${id}-status`}>{notice}</FieldStatus> : null}
      {editing ? (
        <Dialog
          open
          title="Edit your question"
          description="You can edit this question before a moderator makes a decision."
          confirmLabel={pending ? "Retry changes" : "Save changes"}
          confirmDisabled={disabled || !form.valid}
          onConfirm={save}
          onCancel={() => setEditing(false)}
        >
          <form
            noValidate
            class="pk-stack pk-stack--snug"
            {...form.handlers}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Field label="Your question" statusId={`${id}-edit-status`} {...form.of("text")}>
              {(control) => (
                <Textarea
                  {...control}
                  name="text"
                  rows={3}
                  value={text}
                  disabled={disabled || pending !== null}
                  onInput={(event) => setText(event.currentTarget.value)}
                />
              )}
            </Field>
            <FieldStatus id={`${id}-edit-status`} state={form.of("text").state} message={form.of("text").message}>
              {notice ?? ""}
            </FieldStatus>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
