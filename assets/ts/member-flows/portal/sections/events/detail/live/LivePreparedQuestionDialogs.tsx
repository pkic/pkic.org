import { useState } from "preact/hooks";
import type { ClockZone } from "../../../../../../../shared/event-clock";
import { clockTimeZone } from "../../../../../../../shared/event-clock";
import { format24HourClockInZone, formatClockName } from "../../../../../../../shared/format-date";
import { liveQuestionAddressees } from "../../../../../../../shared/live-room-credits";
import {
  livePreparedQuestionInputSchema,
  livePreparedQuestionWindowSchema,
  type LivePreparedQuestion,
} from "../../../../../../../shared/schemas/live-session-prepared-question";
import type {
  LiveCredit,
  LiveRoomClientMessage,
  LiveRoomSession,
} from "../../../../../../../shared/schemas/live-session-room";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Select, Textarea, TextInput } from "../../../../../../ui/TextControl";
import { liveTimerTargetInstant } from "./studio/LiveTimerAddForm";

type Send = (message: LiveRoomClientMessage) => boolean;
const RECONNECTING = "The room is reconnecting. Please try again in a moment.";

/**
 * Writes or edits a question that comes into the open list on its own, at a
 * random moment in the release window, anonymous and approved like any other.
 */
export function LivePreparedQuestionDialog({
  question,
  credits,
  send,
  onClose,
}: {
  /** Null prepares a new question. */
  question: LivePreparedQuestion | null;
  credits: readonly LiveCredit[];
  send: Send;
  onClose: () => void;
}) {
  const [text, setText] = useState(question?.text ?? "");
  const [addressedTo, setAddressedTo] = useState<string | null>(question?.addressedTo ?? null);
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(livePreparedQuestionInputSchema, { text, addressedTo });
  const addressees = liveQuestionAddressees(credits);

  function save() {
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage);
    const sent = send({
      type: "question.prepare",
      preparedId: question?.id ?? null,
      ...(question ? { expectedRevision: question.revision } : {}),
      ...checked.data,
    });
    if (!sent) return setError(RECONNECTING);
    onClose();
  }

  return (
    <Dialog
      open
      title={question ? "Edit prepared question" : "Prepare question"}
      description="It comes in anonymously at a random time in the release window, ready for votes."
      confirmLabel={question ? "Save question" : "Prepare question"}
      onConfirm={save}
      onCancel={onClose}
    >
      <form
        class="pk-stack pk-stack--snug"
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Field label="Question" {...form.of("text")}>
          {(control) => (
            <Textarea
              {...control}
              name="text"
              rows={3}
              value={text}
              onInput={(event) => setText(event.currentTarget.value)}
            />
          )}
        </Field>
        {addressees.length ? (
          <Field label="For" {...form.of("addressedTo")}>
            {(control) => (
              <Select
                {...control}
                name="addressedTo"
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
        {error ? <p class="pk-live-questions__notice">{error}</p> : null}
      </form>
    </Dialog>
  );
}

/** Sets the span, in the event's clock, in which prepared questions come in; each one draws a new moment in it. */
export function LivePreparedQuestionWindowDialog({
  window,
  session,
  clock,
  send,
  onClose,
}: {
  window: { from: string; until: string };
  session: Pick<LiveRoomSession, "startAt">;
  clock: ClockZone;
  send: Send;
  onClose: () => void;
}) {
  const zone = clockTimeZone(clock);
  const shown = (instant: string) => format24HourClockInZone(Date.parse(instant), clock);
  const [from, setFrom] = useState(shown(window.from));
  const [until, setUntil] = useState(shown(window.until));
  const [error, setError] = useState<string | null>(null);
  // An unchanged time keeps the stored instant, so a window that crosses midnight survives an edit of the other end.
  const instant = (time: string, stored: string) =>
    time === shown(stored) ? stored : liveTimerTargetInstant(time, { startAt: stored }, zone);
  const form = useContractForm(livePreparedQuestionWindowSchema, {
    from: instant(from, window.from),
    until: instant(until, window.until),
  });
  const zoneName = formatClockName(clock);

  function save() {
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage);
    if (!send({ type: "question.prepared.window", ...checked.data })) return setError(RECONNECTING);
    onClose();
  }

  return (
    <Dialog
      open
      title="Release times"
      description={`Prepared questions come in at random times between these. The session starts at ${shown(session.startAt)}.`}
      confirmLabel="Save times"
      onConfirm={save}
      onCancel={onClose}
    >
      <form
        class="pk-stack pk-stack--snug"
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div class="pk-cluster">
          <Field label={`From (${zoneName})`} {...form.of("from")}>
            {(control) => (
              <TextInput
                {...control}
                name="from"
                type="time"
                value={from}
                onInput={(event) => setFrom(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label={`Until (${zoneName})`} {...form.of("until")}>
            {(control) => (
              <TextInput
                {...control}
                name="until"
                type="time"
                value={until}
                onInput={(event) => setUntil(event.currentTarget.value)}
              />
            )}
          </Field>
        </div>
        {error ? <p class="pk-live-questions__notice">{error}</p> : null}
      </form>
    </Dialog>
  );
}
