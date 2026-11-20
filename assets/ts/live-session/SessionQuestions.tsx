import { LiveOwnQuestionActions } from "./LiveOwnQuestionActions";
import { LiveQuestionThread } from "./LiveQuestionThread";
import { useHashQueryParam } from "../hooks/useHashQueryParam";
import { LIVE_POLL_ANSWER_REFUSAL } from "../../shared/schemas/live-session-poll";
import { createPortal } from "preact/compat";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { type LiveQuestionOrder } from "../../shared/live-session-policy";
import {
  liveQuestionAskSchema,
  type LiveCredit,
  type LiveRoomClientMessage,
  type LiveRoomServerMessage,
} from "../../shared/schemas/live-session-room";
import { useContractForm } from "../hooks/useContractForm";
import { Alert } from "../ui/Alert";
import { IconPlus } from "../components/icons";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Checkbox } from "../ui/Checkbox";
import { Field } from "../ui/Field";
import { FieldStatus } from "../ui/FieldStatus";
import { TabList } from "../ui/TabList";
import { Select, Textarea } from "../ui/TextControl";
import { liveQuestionAddressees } from "../../shared/live-room-credits";
import { LiveQuestionList, LiveQuestionTransitions } from "./LiveQuestionList";
import { LiveParticipationAlert, useLiveParticipation } from "./LiveParticipationAlert";
import { LiveAuthorProvider } from "./LiveAuthor";
import { LivePollCard } from "./LivePollCard";
import { liveRoomOpenFailure } from "./live-room-copy";
import { currentLivePoll, orderLiveQuestions } from "./live-room-state";
import { useLiveQuestionThread } from "./useLiveQuestionThread";
import { useLiveRoom, type LiveRoomConnection, type LiveSocketFactory } from "./useLiveRoom";
import "./SessionQuestions.css";
import { SectionHeading } from "../ui/SectionHeading";

const ORDERS = [
  { id: "top", label: "Top" },
  { id: "new", label: "New" },
] as const;

import { SessionInteractionWindow, type SessionInteractionProps } from "./SessionInteractionWindow";

const ASK = "Ask a question";

/** The form behind "Ask a question", in a dialog so the list keeps its place. It closes once the room takes the question. */
function AskQuestionDialog({
  disabled,
  credits,
  onAsk,
  result,
  onClose,
}: {
  disabled: boolean;
  /** The session's credits; its speakers and moderator are whom a question may be for. */
  credits: readonly LiveCredit[];
  onAsk: (message: Extract<LiveRoomClientMessage, { type: "question.ask" }>) => boolean;
  result: Extract<LiveRoomServerMessage, { type: "question.accepted" | "room.refused" }> | null;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [addressedTo, setAddressedTo] = useState<string | null>(null);
  const addressees = liveQuestionAddressees(credits);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Extract<LiveRoomClientMessage, { type: "question.ask" }> | null>(null);
  const statusId = useId();
  const form = useContractForm(liveQuestionAskSchema, { text, anonymous, addressedTo }, { quietWhenEmpty: true });
  const field = form.of("text");
  const closed = useRef(onClose);
  closed.current = onClose;
  useEffect(() => {
    if (!pending || result?.operationId !== pending.operationId) return;
    if (result.type === "question.accepted") return closed.current();
    setError(result.message);
    setPending(null);
  }, [pending, result]);
  function ask() {
    // Asking waits for a question: an empty field is at rest, not refused.
    if (!form.valid) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage);
    const request = pending ?? { type: "question.ask", operationId: crypto.randomUUID(), ...checked.data };
    if (!onAsk(request)) return setError("The room is reconnecting. Please try again in a moment.");
    setPending(request);
    setError("Waiting for confirmation. Retry this question if the connection was interrupted.");
  }
  return (
    <Dialog
      open
      title={ASK}
      closeLabel="Close the question form"
      confirmLabel={pending ? "Retry question" : "Ask question"}
      confirmDisabled={disabled || !form.valid}
      onConfirm={ask}
      onCancel={onClose}
    >
      <form
        class="pk-stack pk-stack--snug"
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <Field label="Your question" statusId={statusId} {...field}>
          {(control) => (
            <Textarea
              {...control}
              name="text"
              disabled={disabled || Boolean(pending)}
              rows={3}
              value={text}
              onInput={(event) => setText(event.currentTarget.value)}
            />
          )}
        </Field>
        <div class="pk-live-questions__ask-options">
          {addressees.length ? (
            <Field label="For" {...form.of("addressedTo")}>
              {(control) => (
                <Select
                  {...control}
                  name="addressedTo"
                  disabled={disabled || Boolean(pending)}
                  value={addressedTo ?? ""}
                  onChange={(event) => setAddressedTo(event.currentTarget.value || null)}
                >
                  <option value="">Anyone</option>
                  {addressees.map((credit) => (
                    <option key={credit.key} value={credit.key}>
                      {credit.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Checkbox
            name="anonymous"
            disabled={disabled || Boolean(pending)}
            checked={anonymous}
            onChange={(event) => setAnonymous(event.currentTarget.checked)}
            label="Ask anonymously"
            hint="Other attendees will not see your name. Moderators always can."
          />
        </div>
        <FieldStatus id={statusId} state={field.state} message={field.message}>
          {error ?? ""}
        </FieldStatus>
      </form>
    </Dialog>
  );
}

/**
 * The one way to ask: a button that opens the question form. It is always in view: in the header of the
 * panel that holds the questions where the page gives it that place (`askIn`), else held at the top of
 * the questions as they scroll.
 */
function AskQuestionButton({
  disabled,
  onClick,
  askIn,
  quiet = false,
}: {
  disabled: boolean;
  onClick?: () => void;
  askIn?: HTMLElement | null;
  /** Something else is the main action now, such as an open poll's answer. */
  quiet?: boolean;
}) {
  const button = (
    <Button variant={quiet ? "secondary" : "primary"} disabled={disabled} onClick={onClick}>
      <IconPlus />
      <span>{ASK}</span>
    </Button>
  );
  return askIn ? createPortal(button, askIn) : <div class="pk-live-questions__ask pk-cluster">{button}</div>;
}

/** A session's questions before its room opens: where to ask, not yet in use, and when it opens. */
export function LiveQuestionsClosed({ askIn }: { askIn?: HTMLElement | null }) {
  return (
    <div class="pk-stack pk-stack--snug">
      <AskQuestionButton disabled askIn={askIn} />
      <p class="pk-live-questions__empty">Questions open when the session is live.</p>
    </div>
  );
}

/** The room's attendee side over its own connection, where nothing else on the page holds one. */
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
  return <LiveAttendeeQuestions room={room} occurrenceId={occurrenceId} />;
}

/**
 * A session's questions for an attendee, on a room connection its page already holds: answer the poll, ask,
 * upvote, reply, accept answers, and (for a credited speaker) mark questions answered.
 */
export function LiveAttendeeQuestions({
  room,
  occurrenceId,
  askIn,
}: {
  room: LiveRoomConnection;
  occurrenceId: string;
  /** Where the page keeps the Ask a question button, such as the header of the questions' panel. */
  askIn?: HTMLElement | null;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const threadVisible = threadId !== null && room.state?.questions.some((question) => question.id === threadId);
  useLiveQuestionThread(threadVisible ? threadId : null, room.status === "live", room.send);
  useEffect(() => {
    setThreadId(null);
    setAsking(false);
  }, [occurrenceId]);

  const [order, setOrder] = useHashQueryParam(
    "questionOrder",
    "top",
    ORDERS.map((entry) => entry.id),
  );
  const state = room.state;
  const live = room.status === "live";
  const restriction = useLiveParticipation(state?.viewer.participation);
  if (!state)
    return (
      <div class="pk-stack pk-stack--snug">
        {/* The button keeps its place while the room is joined, so nothing moves when it answers. */}
        <AskQuestionButton disabled askIn={askIn} />
        {room.admissionRefusal ? (
          <Alert tone="warn">{liveRoomOpenFailure(room.admissionRefusal, "attendee")}</Alert>
        ) : room.status === "offline" ? (
          <Alert tone="warn">{liveRoomOpenFailure(null, "attendee", room.serverFault)}</Alert>
        ) : (
          <p class="pk-live-questions__empty">Joining the session’s questions…</p>
        )}
      </div>
    );
  const role = state.viewer.role;
  const poll = currentLivePoll(state.polls);
  return (
    <div class="pk-stack">
      {!live ? (
        <Alert tone="warn">Live updates are paused while we reconnect. What you see may be out of date.</Alert>
      ) : null}
      {restriction ? (
        <LiveParticipationAlert
          restriction={restriction}
          timeZone={state.session.timeZone}
          eventName={state.session.eventName}
        />
      ) : (
        <AskQuestionButton
          disabled={!live}
          onClick={() => setAsking(true)}
          askIn={askIn}
          quiet={poll?.status === "open"}
        />
      )}
      {poll ? (
        <LivePollCard
          poll={poll}
          disabled={!live || restriction !== null}
          refusal={state.refusal}
          onVote={(answer) => room.send({ type: "poll.vote", pollId: poll.id, answer })}
        />
      ) : null}
      {asking && !restriction ? (
        <AskQuestionDialog
          disabled={!live}
          credits={state.session.credits}
          onAsk={room.send}
          result={room.questionResult}
          onClose={() => setAsking(false)}
        />
      ) : null}
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
          credits={state.session.credits}
          questions={orderLiveQuestions(state.questions, order)}
          emptyText="No questions yet. Ask the first one."
          showStatus={(question) => question.mine || role !== "attendee"}
          onVote={
            live && !restriction
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
              viewer={state.viewer}
              restriction={restriction}
              timeZone={state.session.timeZone}
              eventName={state.session.eventName}
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
                  onMove={(status, reason) =>
                    room.send({
                      type: "question.moderate",
                      questionId: question.id,
                      expectedRevision: question.revision,
                      status,
                      reason,
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
    <SessionInteractionWindow {...props} disabledControls={<LiveQuestionsClosed />}>
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
