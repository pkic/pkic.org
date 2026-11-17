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
import { formatNumber } from "../../shared/format-number";
import type { LiveParticipationRestrictionView } from "../../shared/schemas/live-session-moderation";
import { useContractForm } from "../hooks/useContractForm";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { FieldStatus } from "../ui/FieldStatus";
import { Textarea } from "../ui/TextControl";
import { LiveParticipationAlert } from "./LiveParticipationAlert";
import { LiveQuestionAnswerRow, type LiveAnswerViewer } from "./LiveQuestionAnswerRow";
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
  viewer,
  restriction,
  timeZone,
  eventName,
}: {
  viewer: LiveAnswerViewer;
  /** This viewer's block in force: the answer box gives way to why. */
  restriction: LiveParticipationRestrictionView | null;
  timeZone: string;
  eventName?: string;
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
  const [actionError, setActionError] = useState(false);
  // Each new attempt clears the last failure; it shows again only if this one fails too.
  const act = (message: LiveRoomClientMessage) => {
    setActionError(false);
    const sent = send(message);
    if (!sent) setActionError(true);
    return sent;
  };
  const form = useContractForm(liveQuestionAnswerCreateSchema, { text }, { quietWhenEmpty: true });
  const field = form.of("text");
  const resetForm = form.reset;
  useEffect(() => {
    if (!pending || result?.operationId !== pending.operationId) return;
    if (result.type === "question.answer.result") {
      if (result.questionId !== question.id) return;
      if (pending.type === "question.answer") {
        setText("");
        resetForm();
      }
      setNotice(null);
    } else setNotice(result.message);
    setPending(null);
  }, [pending, result, question.id, resetForm]);

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
      <div class="pk-live-answers__summary">
        {question.answerCount ? (
          <span>
            {formatNumber(question.answerCount)} {question.answerCount === 1 ? "answer" : "answers"}
          </span>
        ) : null}
        {question.acceptedAnswer ? <span class="pk-live-answers__accepted-note">Accepted answer</span> : null}
        <Button variant="ghost" aria-expanded={expanded} aria-controls={expanded ? id : undefined} onClick={toggle}>
          {expanded ? "Hide answers" : "Show answers"}
        </Button>
      </div>
      {expanded ? (
        <section id={id} class="pk-live-answers__thread pk-stack pk-stack--snug" aria-label="Answers to this question">
          {!thread ? (
            <p role="status">{disabled ? "Reconnect to load answers." : "Loading answers…"}</p>
          ) : (
            <>
              {actionError ? <Alert tone="danger">Could not complete the action. Please try again.</Alert> : null}
              {thread.answers.length ? (
                <ol class="pk-live-answers__list">
                  {thread.answers.map((answer) => {
                    const mine = pending?.type === "question.answer.accept" && pending.answerId === answer.id;
                    return (
                      <LiveQuestionAnswerRow
                        key={answer.id}
                        answer={answer}
                        questionId={question.id}
                        viewer={viewer}
                        canVote={thread.canVote && !restriction}
                        canAccept={thread.canAccept}
                        canModerate={thread.canModerate}
                        disabled={disabled}
                        accepting={mine ? "this" : pending ? "other" : null}
                        send={act}
                        timeZone={timeZone}
                        onError={() => setActionError(true)}
                        onAccept={() =>
                          transmit(
                            mine
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
                      />
                    );
                  })}
                </ol>
              ) : (
                <p>{thread.canAnswer ? "No answers yet. Add the first answer." : "No answers yet."}</p>
              )}
              {restriction ? (
                <LiveParticipationAlert restriction={restriction} timeZone={timeZone} eventName={eventName} />
              ) : thread.canAnswer ? (
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
