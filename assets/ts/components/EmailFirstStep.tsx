import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import {
  EMAIL_FIRST_ADVISORY_COPY,
  EMAIL_FIRST_CHOICE_QUESTION,
  EMAIL_FIRST_COPY,
  WORK_EMAIL_STEER,
  type EmailFirstChoiceCopy,
  type EmailFirstFlow,
} from "../../shared/email-first-copy";
import { workEmailStepSchema } from "../../shared/schemas/work-email";
import { useContractForm } from "../hooks/useContractForm";
import { useMailboxKind } from "../hooks/useMailboxKind";
import { normalizeValidation } from "../shared/form/validation-map";
import { nextDomId } from "../ui/dom-id";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { ChoiceCard, ChoiceCards } from "../ui/ChoiceCard";
import { Field, StateIcon } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { IconOrganization } from "./icons";
import { IconPerson } from "./icons/app-navigation";

export interface EmailFirstController {
  continue?: () => Promise<void>;
}

type WorkEmailContract = z.ZodType<{ email: string; unaffiliatedAttestation: boolean }>;

/** The card's title with the word that sets it apart from the other drawn with emphasis. */
function ChoiceTitle({ choice, Emphasis }: { choice: EmailFirstChoiceCopy; Emphasis: "strong" | "em" }) {
  const at = choice.title.indexOf(choice.emphasis);
  if (at < 0) return <>{choice.title}</>;
  return (
    <>
      {choice.title.slice(0, at)}
      <Emphasis>{choice.emphasis}</Emphasis>
      {choice.title.slice(at + choice.emphasis.length)}
    </>
  );
}

/**
 * The one email-first step that joining, event registration and proposals
 * start from. Two cards ask first which kind of address the person takes part
 * with — their work email, the default, or a personal one — and say what each
 * means before it is chosen; one field and one action follow the choice.
 *
 * The caller owns the address, the capacity and what continuing does (send a
 * confirmation link, look up a signed-in person); this step owns the choice,
 * the field, its contract and the wording. `schema` is the route's own request
 * contract, built on the shared work-email step, and `body` carries its other
 * fields. The personal card is the contract's `unaffiliatedAttestation`.
 *
 * Which domains are free, disposable or an organization's is known only to
 * the server. A free mailbox under the work card arrives as the server's
 * refusal of `onContinue`, read onto the field through the shared validation
 * map; a domain the server classifies as work under the personal card is
 * offered back to the work card, never refused.
 */
export function EmailFirstStep<Schema extends WorkEmailContract>({
  flow,
  schema,
  body,
  email,
  onEmailChange,
  individual,
  onIndividualChange,
  onContinue,
  sentTo,
  onChangeEmail,
  controller,
  onBusy,
}: {
  flow: EmailFirstFlow;
  schema?: Schema;
  body?: Record<string, unknown>;
  email: string;
  onEmailChange: (email: string) => void;
  individual: boolean;
  onIndividualChange: (individual: boolean) => void;
  /** Rejects with the server's refusal, which the step reads back onto its field. */
  onContinue: (step: z.output<Schema>) => Promise<void>;
  /** The address a confirmation link went to; the step then says so instead of asking. */
  sentTo?: string | null;
  onChangeEmail?: () => void;
  controller?: EmailFirstController;
  onBusy?: (busy: boolean) => void;
}) {
  const copy = EMAIL_FIRST_COPY[flow];
  const choice = individual ? copy.personal : copy.work;
  const form = useContractForm(schema ?? workEmailStepSchema, {
    ...body,
    email,
    unaffiliatedAttestation: individual,
  });
  const [busy, setBusy] = useState(false);
  // State lags a render behind, so two clicks, or Enter and a click, in one tick would both send.
  const sending = useRef(false);
  useEffect(() => onBusy?.(busy), [busy]);
  if (controller) controller.continue = proceed;
  useEffect(
    () => () => {
      if (controller) delete controller.continue;
    },
    [controller],
  );
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [group] = useState(() => nextDomId("email-choice"));
  // The address the reader finished typing: classified once, not per keystroke.
  const [settled, setSettled] = useState("");
  const kind = useMailboxKind(individual && settled === email.trim() ? settled : null);

  async function proceed(): Promise<void> {
    if (sending.current) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(null);
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onContinue(checked.data as z.output<Schema>);
    } catch (caught) {
      // A refusal that names a field shows on it (the steer among them); only the rest needs the alert.
      const message = form.refuse(caught);
      setError(Object.keys(normalizeValidation(caught).fields).length > 0 ? null : message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (sentTo)
    return (
      <div class="pk-stack">
        <Alert tone="info" title={copy.sentTitle}>
          {copy.sent(sentTo)}
        </Alert>
        {onChangeEmail && (
          <div class="pk-cluster">
            <Button type="button" variant="secondary" onClick={onChangeEmail}>
              {copy.changeEmail}
            </Button>
          </div>
        )}
      </div>
    );

  const focusEmail = () => root.current?.querySelector<HTMLInputElement>('input[name="email"]')?.focus();
  const choose = (value: boolean) => {
    if (value === individual) return;
    onIndividualChange(value);
    // A refusal answered the other card; the next continue asks again.
    form.reset();
    setError(null);
  };
  // The preferred path after a steer: clear the personal address and return to the field for the work one.
  const enterWorkAddress = () => {
    onEmailChange("");
    form.reset();
    setError(null);
    focusEmail();
  };
  const switchCard = (value: boolean) => {
    choose(value);
    focusEmail();
  };

  // The steer is the server's refusal of a free mailbox, drawn as advice rather than as an error.
  const presentation = form.of("email");
  const steered = !individual && presentation.message === WORK_EMAIL_STEER;
  const looksWork = individual && kind === "work" && !presentation.message;
  const field = steered
    ? { state: "advisory" as const, message: WORK_EMAIL_STEER }
    : looksWork
      ? { state: "advisory" as const, message: EMAIL_FIRST_ADVISORY_COPY.looksWork }
      : presentation;
  const submitOnEnter = (event: JSX.TargetedKeyboardEvent<HTMLInputElement>) => {
    // The step may sit inside a larger form; Enter continues this step rather than submitting that form.
    if (event.key !== "Enter") return;
    event.preventDefault();
    setSettled(email.trim());
    void proceed();
  };

  return (
    <div class="pk-stack" ref={root} {...form.handlers}>
      <ChoiceCards legend={EMAIL_FIRST_CHOICE_QUESTION} legendHidden>
        <ChoiceCard
          name={group}
          value="work"
          checked={!individual}
          onChange={() => choose(false)}
          icon={<IconOrganization />}
          title={<ChoiceTitle choice={copy.work} Emphasis="strong" />}
          description={copy.work.description}
          points={copy.work.points}
          pointTone="gain"
        />
        <ChoiceCard
          name={group}
          value="personal"
          checked={individual}
          onChange={() => choose(true)}
          icon={<IconPerson />}
          iconMark={<StateIcon state="advisory" />}
          title={<ChoiceTitle choice={copy.personal} Emphasis="em" />}
          description={copy.personal.description}
          points={copy.personal.points}
          pointTone="cost"
        />
      </ChoiceCards>
      <Field label={choice.label} errorSlot="email" state={field.state} message={field.message}>
        {(control) => (
          <TextInput
            {...control}
            type="email"
            name="email"
            value={email}
            placeholder={choice.placeholder}
            autoComplete="email"
            onInput={(event) => onEmailChange(event.currentTarget.value)}
            onBlur={(event) => setSettled(event.currentTarget.value.trim())}
            onKeyDown={submitOnEnter}
          />
        )}
      </Field>
      <div class="pk-cluster">
        {steered ? (
          <>
            <Button type="button" variant="primary" onClick={enterWorkAddress}>
              {EMAIL_FIRST_ADVISORY_COPY.enterWork}
            </Button>
            <Button type="button" variant="secondary" onClick={() => switchCard(true)}>
              {EMAIL_FIRST_ADVISORY_COPY.usePersonal}
            </Button>
          </>
        ) : (
          <>
            {!controller && (
              <Button type="button" variant="primary" loading={busy} onClick={() => void proceed()}>
                {choice.action}
              </Button>
            )}
            {looksWork && (
              <Button type="button" variant="secondary" onClick={() => switchCard(false)}>
                {EMAIL_FIRST_ADVISORY_COPY.useAsWork}
              </Button>
            )}
          </>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
