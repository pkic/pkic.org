import { useEffect, useId, useState } from "preact/hooks";
import type { z } from "zod";
import {
  liveQuestionAnswerCreateSchema,
  type liveQuestionAnswersSchema,
} from "../../shared/schemas/live-session-answer";
import type {
  LiveQuestion,
  LiveRoomClientMessage,
  LiveRoomServerMessage,
} from "../../shared/schemas/live-session-room";
import { useContractForm } from "../hooks/useContractForm";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { FieldStatus } from "../ui/FieldStatus";
import { Textarea } from "../ui/TextControl";
import { LiveAuthorName } from "./LiveAuthor";
import "./LiveQuestionThread.css";

type Pending = Extract<LiveRoomClientMessage, { type: "question.answer" | "question.answer.accept" }>;
type Receipt = Extract<LiveRoomServerMessage, { type: "question.answer.result" | "room.refused" }>;

/** One question's replies, with acceptance authority supplied by the room rather than inferred from speaker duties. */
export function LiveQuestionThread({
  question,
  expanded,
  toggle,
  thread,
  disabled,
  send,
  result,
}: {
  question: LiveQuestion;
  expanded: boolean;
  toggle: () => void;
  thread: z.infer<typeof liveQuestionAnswersSchema> | null;
  disabled: boolean;
  send: (message: LiveRoomClientMessage) => boolean;
  result: Receipt | null;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const form = useContractForm(liveQuestionAnswerCreateSchema, { text }, { quietWhenEmpty: true });
  const field = form.of("text");
  useEffect(() => {
    if (!pending || result?.operationId !== pending.operationId) return;
    if (result.type === "question.answer.result") {
      if (result.questionId !== question.id) return;
      if (pending.type === "question.answer") {
        setText("");
        form.reset();
      }
      setNotice(null);
    } else setNotice(result.message);
    setPending(null);
  }, [pending, result, question.id]);

  function transmit(request: Pending) {
    if (!send(request)) {
      setNotice("The room is reconnecting. Please try again in a moment.");
      return;
    }
    setPending(request);
    setNotice("Waiting for confirmation. You can retry the same action if the connection was interrupted.");
  }

  return (
    <div class="pk-live-answers">
      <Button variant="ghost" aria-expanded={expanded} aria-controls={expanded ? id : undefined} onClick={toggle}>
        {expanded ? "Hide answers" : "Show answers"}
      </Button>
      {expanded ? (
        <section id={id} class="pk-live-answers__thread pk-stack pk-stack--snug" aria-label="Answers to this question">
          {!thread ? (
            <p role="status">{disabled ? "Reconnect to load answers." : "Loading answers…"}</p>
          ) : (
            <>
              {thread.answers.length ? (
                <ol class="pk-live-answers__list">
                  {thread.answers.map((answer) => (
                    <li key={answer.id} class="pk-live-answers__answer pk-stack pk-stack--snug">
                      <LiveAuthorName
                        name={answer.authorName}
                        affiliation={answer.authorAffiliation}
                        roles={answer.authorRoles}
                      />
                      <p class="pk-live-answers__text">{answer.text}</p>
                      {answer.acceptance ? (
                        <p class="pk-live-answers__acceptance">
                          {answer.acceptance.byName === null
                            ? "Accepted by the question author"
                            : `Accepted by ${answer.acceptance.byName}`}
                        </p>
                      ) : null}
                      {thread.canAccept ? (
                        <div class="pk-cluster">
                          <Button
                            variant="secondary"
                            disabled={
                              disabled ||
                              (pending !== null &&
                                (pending.type !== "question.answer.accept" || pending.answerId !== answer.id))
                            }
                            aria-pressed={answer.acceptance !== null}
                            onClick={() =>
                              transmit(
                                pending?.type === "question.answer.accept" && pending.answerId === answer.id
                                  ? pending
                                  : {
                                      type: "question.answer.accept",
                                      questionId: question.id,
                                      answerId: answer.id,
                                      operationId: crypto.randomUUID(),
                                      expectedRevision: answer.revision,
                                      accepted: answer.acceptance === null,
                                    },
                              )
                            }
                          >
                            {pending?.type === "question.answer.accept" && pending.answerId === answer.id
                              ? "Retry decision"
                              : answer.acceptance
                                ? "Remove acceptance"
                                : "Accept answer"}
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>{thread.canAnswer ? "No answers yet. Add the first answer." : "No answers yet."}</p>
              )}
              {thread.canAnswer ? (
                <form
                  noValidate
                  class="pk-stack pk-stack--snug"
                  {...form.handlers}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (pending?.type === "question.answer.accept") return;
                    const checked = form.submit();
                    if (!checked.data) return setNotice(checked.formMessage);
                    transmit(
                      pending ?? {
                        type: "question.answer",
                        questionId: question.id,
                        operationId: crypto.randomUUID(),
                        ...checked.data,
                      },
                    );
                  }}
                >
                  <Field label="Your answer" help="Answers show your name." statusId={`${id}-status`} {...field}>
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
                  <FieldStatus id={`${id}-status`} state={field.state} message={field.message}>
                    {notice ?? ""}
                  </FieldStatus>
                  <div class="pk-cluster">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={disabled || !form.valid || pending?.type === "question.answer.accept"}
                    >
                      {pending?.type === "question.answer" ? "Retry answer" : "Post answer"}
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <p>
                    {question.withdrawn
                      ? "Answers are closed because this question was withdrawn."
                      : question.status === "pending"
                        ? "Answers open after a moderator approves this question."
                        : question.status === "hidden"
                          ? "Answers are unavailable while this question is hidden."
                          : "This session is not taking more answers."}
                  </p>
                  <FieldStatus id={`${id}-status`}>{notice ?? ""}</FieldStatus>
                </>
              )}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
