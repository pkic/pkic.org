import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CustomAnswerValue } from "../../shared/form-answer-rules";
import { formatNumber } from "../../shared/format-number";
import { LIVE_POLL_ANSWER_REFUSAL, type LivePoll, type LivePollField } from "../../shared/schemas/live-session-poll";
import { FormFieldStatChart } from "../components/forms/FormResponseStats";
import { useFormAnswers } from "../components/forms/useFormAnswers";
import type { FormField } from "../shared/types";
import { CustomFieldList } from "../shared/widgets/custom-fields";
import { Button } from "../ui/Button";
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
 * The poll an attendee is asked now. The question is answered with the same
 * controls and the same generated answer contract as any form; one answer per
 * person, changeable while the poll is open. It shows one thing at a time:
 * the choices until the person has answered, then the results they may see,
 * with a way back to the choices. Results are drawn as the stream draws them:
 * each answer over its bar, its share at the end, the bars in the brand
 * stripe, and how many voted said once. It sits in its panel without a card
 * of its own.
 */
export function LivePollCard({
  poll,
  disabled,
  refusal,
  onVote,
}: {
  poll: LivePoll;
  disabled: boolean;
  /** The room's latest refusal; an answer it refused is marked on the question. */
  refusal: { sequence: number; code: string; message: string } | null;
  onVote: (answer: CustomAnswerValue) => void;
}) {
  const field = useMemo(() => livePollFormField(poll.field), [poll.field]);
  const fields = useMemo(() => [field], [field]);
  const answers = useFormAnswers(fields);
  const open = poll.status === "open";
  const answered = poll.myAnswer !== null;
  const mine = JSON.stringify(poll.myAnswer);
  // Only the person's own answer refills the question: a tally arriving
  // while they choose must not undo a choice they have not sent yet.
  const initialValues = useMemo(
    () => (answered ? { [field.key]: JSON.parse(mine) as CustomAnswerValue } : undefined),
    [answered, field.key, mine],
  );
  const { sync, refuseAnswer } = answers;
  useLayoutEffect(sync, [mine, sync]);
  // Once answered, the choices give way to the results; "Change answer" brings them back.
  const [changing, setChanging] = useState(false);
  useEffect(() => setChanging(false), [mine]);
  const choosing = open && (!answered || changing);

  // The room's refusal of an answer is said once, on the question it is about.
  const currentRefusal = useRef({ refusal, fieldKey: field.key, refuseAnswer });
  currentRefusal.current = { refusal, fieldKey: field.key, refuseAnswer };
  const refusalSequence = refusal?.sequence;
  useEffect(() => {
    const { refusal, fieldKey, refuseAnswer } = currentRefusal.current;
    if (refusal?.code !== LIVE_POLL_ANSWER_REFUSAL) return;
    // A refused answer is said on the question, so the choices come back with it.
    setChanging(true);
    refuseAnswer(fieldKey, refusal.message);
  }, [refusalSequence]);

  function send(event: Event) {
    event.preventDefault();
    const checked = answers.submit();
    const answer = checked.data?.[field.key];
    if (answer !== undefined) onVote(answer);
  }

  const respondents = poll.results?.totalAnswers ?? 0;
  return (
    <section class="pk-live-poll-card pk-stack pk-stack--snug" aria-label="Poll">
      <p class="pk-live-poll-card__kicker">
        {open ? "Poll" : "Poll results"}
        {poll.results ? ` · ${formatNumber(respondents)} ${respondents === 1 ? "vote" : "votes"}` : ""}
      </p>
      {choosing ? (
        <form ref={answers.formRef} class="pk-stack pk-stack--snug" noValidate {...answers.handlers} onSubmit={send}>
          <CustomFieldList
            key={poll.id}
            fields={fields}
            context={{ dayAttendance: [] }}
            initialValues={initialValues}
            presentationOf={answers.presentationOf}
          />
          <div class="pk-cluster">
            <Button type="submit" variant="primary" disabled={disabled}>
              Send answer
            </Button>
            {answered ? <Button onClick={() => setChanging(false)}>Keep my answer</Button> : null}
          </div>
          <p class="pk-small pk-muted">One answer per person. You can change it until the poll closes.</p>
        </form>
      ) : (
        <p class="pk-strong">{poll.field.label}</p>
      )}
      {!choosing && poll.results ? (
        <FormFieldStatChart field={poll.field} stat={poll.results} visualization="bar" presentation />
      ) : null}
      {open && !choosing ? (
        <div class="pk-cluster">
          <p class="pk-small pk-muted" role="status">
            Your answer is in.
          </p>
          <Button disabled={disabled} onClick={() => setChanging(true)}>
            Change answer
          </Button>
        </div>
      ) : null}
    </section>
  );
}
