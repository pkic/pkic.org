import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CustomAnswerValue } from "../../shared/form-answer-rules";
import { formatNumber } from "../../shared/format-number";
import { LIVE_POLL_ANSWER_REFUSAL, type LivePoll, type LivePollField } from "../../shared/schemas/live-session-poll";
import { FormFieldStatChart } from "../components/forms/FormResponseStats";
import { useFormAnswers } from "../components/forms/useFormAnswers";
import type { FormField } from "../shared/types";
import { CustomFieldList } from "../shared/widgets/custom-fields";
import { IconPoll } from "../components/icons/app-navigation";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import "./LivePollOverlay.css";

/** A poll's question as the forms respondent controls read a field. */
export function livePollFormField(field: LivePollField): FormField {
  return {
    ...field,
    options: field.options ?? null,
    optionSource: null,
    validation: field.validation ?? null,
  };
}

/**
 * The poll an attendee is asked now, listed first among the questions as one of them, since a poll is a
 * question put to the room: what is asked, and a button that opens it. The poll itself is a dialog. It holds the choices until the person has
 * answered, with the same controls and the same generated answer contract as any form, and after that the
 * results they may see: one answer per person, and it is final. When a poll is asked the dialog opens by
 * itself once, since a poll is for now; closing it leaves the row.
 *
 * Results are drawn as the stream draws them: each answer over its bar in the brand stripe, its share at
 * the end of its line, and how many voted said once.
 */
export function LivePollCard({
  poll,
  disabled,
  refusal,
  onVote,
  prompt = true,
}: {
  poll: LivePoll;
  disabled: boolean;
  /** The room's latest refusal; an answer it refused is marked on the question. */
  refusal: { sequence: number; code: string; message: string } | null;
  onVote: (answer: CustomAnswerValue) => void;
  /** Whether a poll just asked may open by itself; false while something else has the person's attention. */
  prompt?: boolean;
}) {
  const field = useMemo(() => livePollFormField(poll.field), [poll.field]);
  const fields = useMemo(() => [field], [field]);
  const answers = useFormAnswers(fields);
  const asked = poll.status === "open";
  const answered = poll.myAnswer !== null;
  const choosing = asked && !answered;
  const { refuseAnswer } = answers;

  const [shown, setShown] = useState(false);
  // Asked once per poll: someone who closed it is not asked again by every tally that arrives.
  const prompted = useRef<string | null>(null);
  useEffect(() => {
    if (!choosing || !prompt || disabled || prompted.current === poll.id) return;
    prompted.current = poll.id;
    setShown(true);
  }, [choosing, prompt, disabled, poll.id]);

  // The room's refusal of an answer is said once, on the question it is about.
  const currentRefusal = useRef({ refusal, fieldKey: field.key, refuseAnswer });
  currentRefusal.current = { refusal, fieldKey: field.key, refuseAnswer };
  const refusalSequence = refusal?.sequence;
  useEffect(() => {
    const { refusal, fieldKey, refuseAnswer } = currentRefusal.current;
    if (refusal?.code === LIVE_POLL_ANSWER_REFUSAL) refuseAnswer(fieldKey, refusal.message);
  }, [refusalSequence]);

  function send(event?: Event) {
    event?.preventDefault();
    const checked = answers.submit();
    const answer = checked.data?.[field.key];
    if (answer !== undefined) onVote(answer);
  }
  const close = () => setShown(false);

  const votes = poll.results?.totalAnswers ?? 0;
  const tally = poll.results ? ` · ${formatNumber(votes)} ${votes === 1 ? "vote" : "votes"}` : "";
  return (
    <>
      {/* Where a question has its votes, the poll has its mark. */}
      <span class="pk-live-question__vote pk-live-poll-card__mark" aria-hidden="true">
        <IconPoll width="20" height="20" />
      </span>
      <div class="pk-live-question__body pk-live-poll-card__body" data-density="compact">
        <div class="pk-live-poll-card__text">
          <p class="pk-live-poll-card__kicker">
            {asked ? "Poll" : "Poll results"}
            {tally}
          </p>
          <p>{poll.field.label}</p>
        </div>
        {choosing ? (
          <Button variant="primary" disabled={disabled} onClick={() => setShown(true)}>
            Answer poll
          </Button>
        ) : poll.results ? (
          <Button onClick={() => setShown(true)}>See results</Button>
        ) : (
          <p class="pk-small pk-muted" role="status">
            {asked ? "Your answer is in." : "This poll is closed."}
          </p>
        )}
      </div>
      {shown ? (
        <Dialog
          open
          title={choosing ? "Poll" : "Poll results"}
          closeLabel="Close the poll"
          confirmLabel={choosing ? "Send answer" : "Close"}
          cancelLabel={choosing ? "Not now" : null}
          confirmDisabled={choosing && disabled}
          onConfirm={choosing ? () => send() : close}
          onCancel={close}
        >
          {choosing ? (
            <form
              ref={answers.formRef}
              class="pk-stack pk-stack--snug"
              noValidate
              {...answers.handlers}
              onSubmit={send}
            >
              <CustomFieldList
                key={poll.id}
                fields={fields}
                context={{ dayAttendance: [] }}
                presentationOf={answers.presentationOf}
              />
              <p class="pk-small pk-muted">One answer per person. It cannot be changed once sent.</p>
            </form>
          ) : (
            <div class="pk-live-poll-results pk-stack pk-stack--snug">
              <p class="pk-strong">{poll.field.label}</p>
              {poll.results ? (
                <>
                  <FormFieldStatChart field={poll.field} stat={poll.results} visualization="bar" presentation />
                  <p class="pk-small pk-muted">
                    {formatNumber(votes)} {votes === 1 ? "vote" : "votes"}
                    {asked ? " so far" : ""}
                  </p>
                </>
              ) : (
                <p class="pk-small pk-muted" role="status">
                  Your answer is in.
                </p>
              )}
            </div>
          )}
        </Dialog>
      ) : null}
    </>
  );
}
