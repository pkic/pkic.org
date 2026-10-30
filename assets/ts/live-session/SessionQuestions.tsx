import { LiveOwnQuestionActions } from "./LiveOwnQuestionActions";
import { LiveQuestionThread } from "./LiveQuestionThread";
import { useHashQueryParam } from "../hooks/useHashQueryParam";
import { LIVE_POLL_ANSWER_REFUSAL } from "../../shared/schemas/live-session-poll";
import { useEffect, useId, useState } from "preact/hooks";
import { type LiveQuestionOrder } from "../../shared/live-session-policy";
import {
  liveQuestionAskSchema,
  type LiveRoomClientMessage,
  type LiveRoomServerMessage,
} from "../../shared/schemas/live-session-room";
import { useContractForm } from "../hooks/useContractForm";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Field } from "../ui/Field";
import { FieldStatus } from "../ui/FieldStatus";
import { TabList } from "../ui/TabList";
import { Textarea } from "../ui/TextControl";
import { LiveQuestionList, LiveQuestionTransitions } from "./LiveQuestionList";
import { LiveAuthorProvider } from "./LiveAuthor";
import { LivePollCard } from "./LivePollCard";
import { liveRoomOpenFailure } from "./live-room-copy";
import { currentLivePoll, orderLiveQuestions } from "./live-room-state";
import { useLiveRoom, type LiveSocketFactory } from "./useLiveRoom";
import "./SessionQuestions.css";
import { SectionHeading } from "../ui/SectionHeading";

const ORDERS = [
  { id: "top", label: "Top" },
  { id: "new", label: "New" },
] as const;

import { SessionInteractionWindow, type SessionInteractionProps } from "./SessionInteractionWindow";

function AskQuestion({
  disabled,
  onAsk,
  result,
}: {
  disabled: boolean;
  onAsk: (message: Extract<LiveRoomClientMessage, { type: "question.ask" }>) => boolean;
  result: Extract<LiveRoomServerMessage, { type: "question.accepted" | "room.refused" }> | null;
}) {
  const [text, setText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Extract<LiveRoomClientMessage, { type: "question.ask" }> | null>(null);
  const statusId = useId();
  const form = useContractForm(liveQuestionAskSchema, { text, anonymous }, { quietWhenEmpty: true });
  const field = form.of("text");
  useEffect(() => {
    if (!pending || result?.operationId !== pending.operationId) return;
    if (result.type === "question.accepted") {
      setText("");
      form.reset();
      setError(null);
    } else setError(result.message);
    setPending(null);
  }, [pending, result]);
  return (
    <form
      class="pk-stack pk-stack--snug"
      noValidate
      {...form.handlers}
      onSubmit={(event) => {
        event.preventDefault();
        // Ask waits for a question: an empty field is at rest, not refused.
        if (!form.valid) return;
        const checked = form.submit();
        if (!checked.data) return setError(checked.formMessage);
        const request = pending ?? { type: "question.ask", operationId: crypto.randomUUID(), ...checked.data };
        if (!onAsk(request)) return setError("The room is reconnecting. Please try again in a moment.");
        setPending(request);
        setError("Waiting for confirmation. Retry this question if the connection was interrupted.");
      }}
    >
      <Field label="Your question" statusId={statusId} {...field}>
        {(control) => (
          <Textarea
            {...control}
            name="text"
            disabled={disabled || Boolean(pending)}
            rows={2}
            value={text}
            onInput={(event) => setText(event.currentTarget.value)}
          />
        )}
      </Field>
      <Checkbox
        name="anonymous"
        disabled={disabled || Boolean(pending)}
        checked={anonymous}
        onChange={(event) => setAnonymous(event.currentTarget.checked)}
        label="Ask anonymously"
        hint="Other attendees will not see your name. Moderators always can."
      />
      <FieldStatus id={statusId} state={field.state} message={field.message}>
        {error ?? ""}
      </FieldStatus>
      <div class="pk-cluster">
        <Button type="submit" variant="primary" disabled={disabled || !form.valid}>
          {pending ? "Retry question" : "Ask"}
        </Button>
      </div>
    </form>
  );
}

/** The room's attendee side: answer the poll, ask, upvote, reply, accept answers, and (for a credited speaker) mark questions answered. */
function SessionQuestionsRoom({
  slug,
  occurrenceId,
  createSocket,
}: {
  slug: string;
  occurrenceId: string;
  createSocket?: LiveSocketFactory;
}) {
  const room = useLiveRoom({ slug, occurrenceId, createSocket });
  const [threadId, setThreadId] = useState<string | null>(null);
  const threadVisible = threadId !== null && room.state?.questions.some((question) => question.id === threadId);
  useEffect(() => {
    if (!threadId || !threadVisible || room.status !== "live") return;
    room.send({ type: "question.answers.watch", questionId: threadId });
    return () => {
      room.send({ type: "question.answers.watch", questionId: null });
    };
  }, [threadId, threadVisible, room.status, room.send]);
  useEffect(() => {
    setThreadId(null);
  }, [occurrenceId]);

  const [order, setOrder] = useHashQueryParam(
    "questionOrder",
    "top",
    ORDERS.map((entry) => entry.id),
  );
  const state = room.state;
  const live = room.status === "live";
  if (!state)
    return room.admissionRefusal ? (
      <Alert tone="warn">{liveRoomOpenFailure(room.admissionRefusal, "attendee")}</Alert>
    ) : room.status === "offline" ? (
      <Alert tone="warn">{liveRoomOpenFailure(null, "attendee")}</Alert>
    ) : (
      <p class="pk-live-questions__empty">Joining the session’s questions…</p>
    );
  const role = state.viewer.role;
  const poll = currentLivePoll(state.polls);
  return (
    <div class="pk-stack">
      {!live ? (
        <Alert tone="warn">Live updates are paused while we reconnect. What you see may be out of date.</Alert>
      ) : null}
      {poll ? (
        <LivePollCard
          poll={poll}
          disabled={!live}
          refusal={state.refusal}
          onVote={(answer) => room.send({ type: "poll.vote", pollId: poll.id, answer })}
        />
      ) : null}
      <AskQuestion key={occurrenceId} disabled={!live} onAsk={room.send} result={room.questionResult} />
      {/* A refused poll answer is said on the poll's question instead. */}
      <p class="pk-live-questions__notice" role="status">
        {state.refusal && state.refusal.code !== LIVE_POLL_ANSWER_REFUSAL ? state.refusal.message : ""}
      </p>
      <TabList
        label="Order questions"
        items={ORDERS}
        activeId={order}
        onSelect={(id) => setOrder(id as LiveQuestionOrder)}
      />
      <LiveAuthorProvider authors={state.authors} send={room.send}>
        <LiveQuestionList
          photos
          questions={orderLiveQuestions(state.questions, order)}
          emptyText="No questions yet. Ask the first one."
          showStatus={(question) => question.mine || role !== "attendee"}
          onVote={
            live
              ? (question) => room.send({ type: "question.vote", questionId: question.id, voted: !question.votedByMe })
              : undefined
          }
          thread={(question) => (
            <LiveQuestionThread
              question={question}
              expanded={threadId === question.id}
              toggle={() => setThreadId((previous) => (previous === question.id ? null : question.id))}
              thread={room.state?.thread?.questionId === question.id ? room.state.thread : null}
              disabled={!live}
              send={room.send}
              result={room.answerResult}
            />
          )}
          actions={(question) => (
            <>
              <LiveOwnQuestionActions
                question={question}
                disabled={!live}
                send={room.send}
                result={room.questionChangeResult}
              />
              {role === "speaker" ? (
                <LiveQuestionTransitions
                  question={question}
                  role={role}
                  disabled={!live}
                  onMove={(status) =>
                    room.send({
                      type: "question.moderate",
                      questionId: question.id,
                      expectedRevision: question.revision,
                      status,
                    })
                  }
                />
              ) : null}
            </>
          )}
        />
      </LiveAuthorProvider>
    </div>
  );
}

/**
 * A session's Questions section in its details: present only while the room
 * is open to attendees, from shortly before the start until after the end.
 */
export function SessionQuestions(props: SessionInteractionProps) {
  const { slug, occurrenceId, createSocket, labelledBy } = props;
  return (
    <SessionInteractionWindow {...props} disabledControls={<AskQuestion disabled onAsk={() => false} result={null} />}>
      <section class="pk-stack pk-stack--snug" aria-labelledby={labelledBy ?? `${occurrenceId}-questions`}>
        {!labelledBy && (
          <SectionHeading level={3} id={`${occurrenceId}-questions`}>
            Questions
          </SectionHeading>
        )}
        <SessionQuestionsRoom slug={slug} occurrenceId={occurrenceId} createSocket={createSocket} />
      </section>
    </SessionInteractionWindow>
  );
}
