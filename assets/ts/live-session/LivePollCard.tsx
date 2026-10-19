import { useEffect, useLayoutEffect, useMemo } from "preact/hooks";
import type { CustomAnswerValue } from "../../shared/form-answer-rules";
import { formatNumber } from "../../shared/format-number";
import { LIVE_POLL_ANSWER_REFUSAL, type LivePoll, type LivePollField } from "../../shared/schemas/live-session-poll";
import { FormFieldStatChart } from "../components/forms/FormResponseStats";
import { useFormAnswers } from "../components/forms/useFormAnswers";
import type { FormField } from "../shared/types";
import { CustomFieldList } from "../shared/widgets/custom-fields";
import { Button } from "../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";

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
 * controls and the same generated answer contract as any form; one answer per person, changeable
 * while the poll is open, and the forms results chart when results are shown.
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

  // The room's refusal of an answer is said once, on the question it is about.
  useEffect(() => {
    if (refusal?.code === LIVE_POLL_ANSWER_REFUSAL) refuseAnswer(field.key, refusal.message);
  }, [refusal?.sequence]);

  function send(event: Event) {
    event.preventDefault();
    const checked = answers.submit();
    const answer = checked.data?.[field.key];
    if (answer !== undefined) onVote(answer);
  }

  const respondents = poll.results?.totalAnswers ?? 0;
  return (
    <Panel aria-label="Poll">
      <PanelHeader title={open ? "Poll" : `Poll results: ${poll.field.label}`} />
      <PanelBody class="pk-stack pk-stack--snug">
        {open ? (
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
                {answered ? "Change answer" : "Send answer"}
              </Button>
            </div>
          </form>
        ) : null}
        {poll.results ? <FormFieldStatChart field={poll.field} stat={poll.results} visualization="bar" /> : null}
        <p class="pk-small pk-muted" role="status">
          {open
            ? answered
              ? "Your answer is in. You can change it until the poll closes."
              : "One answer per person. You can change it until the poll closes."
            : `${formatNumber(respondents)} ${respondents === 1 ? "person" : "people"} answered`}
        </p>
      </PanelBody>
    </Panel>
  );
}
