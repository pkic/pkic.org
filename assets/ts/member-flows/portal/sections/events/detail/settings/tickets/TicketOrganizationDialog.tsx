/**
 * Tests the classifier on one organization, as registration would ask it,
 * and saves the right ticket as an organizer's decision. A test stores
 * nothing; only Save does. From the ticket editor it tests the ticket's
 * unsaved "who gets this ticket" and saves nothing.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { postJson } from "../../../../../../../shared/api-client";
import { successResponseSchema } from "../../../../../../../../shared/schemas/api-common";
import type { EventTicketsConfiguration } from "../../../../../../../../shared/schemas/event-tickets";
import {
  eventTicketOrganizationDecisionSchema,
  eventTicketOrganizationTrialResponseSchema,
  ticketOrganizationSubjectSchema,
  type EventTicketClassifierDraft,
  type EventTicketOrganizationDecisions,
  type EventTicketOrganizationTrial,
  type EventTicketOrganizationTrialResult,
} from "../../../../../../../../shared/schemas/event-ticket-organizations";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../../ui/Alert";
import { Button } from "../../../../../../../ui/Button";
import { Radio } from "../../../../../../../ui/Checkbox";
import { DescriptionList } from "../../../../../../../ui/DescriptionList";
import { Dialog } from "../../../../../../../ui/Dialog";
import { Field } from "../../../../../../../ui/Field";
import { TextInput } from "../../../../../../../ui/TextControl";
import { ticketsEndpoint } from "./tickets-endpoint";

type TicketType = EventTicketsConfiguration["types"][number];

/** What the dialog opens with: empty for a new test, or a listed organization. */
export interface TicketOrganizationStart {
  organizationName: string;
  emailDomain: string;
  ticketKey?: string;
  /** Asks the classifier as soon as it opens. */
  testOnOpen?: boolean;
}

function decidedBy(current: NonNullable<EventTicketOrganizationTrialResult["current"]>): string {
  return current.decidedBy === "organizer"
    ? "by an organizer"
    : `by the classifier, ${String(current.confidencePercent ?? 0)}% sure`;
}

export function TicketOrganizationDialog({
  slug,
  tickets,
  classifierOn,
  start,
  draft,
  onClose,
  onSaved,
}: {
  slug: string;
  /** The tickets the event offers. */
  tickets: readonly TicketType[];
  /** Whether enough tickets describe who qualifies for the classifier to be tested. */
  classifierOn: boolean;
  start: TicketOrganizationStart;
  /** A ticket as it is being edited: the test reads it in place of the saved one, and nothing is saved. */
  draft?: { input: EventTicketClassifierDraft; name: string };
  onClose: () => void;
  onSaved?: (ticketName: string) => Promise<void>;
}) {
  const [organizationName, setOrganizationName] = useState(start.organizationName);
  const [emailDomain, setEmailDomain] = useState(start.emailDomain);
  const [ticketKey, setTicketKey] = useState(start.ticketKey ?? "");
  const [answer, setAnswer] = useState<EventTicketOrganizationTrialResult | null>(null);
  const [busy, setBusy] = useState<"testing" | "saving" | null>(null);
  const [error, setError] = useState("");
  const subject = { organizationName, emailDomain: emailDomain.trim() || undefined };
  const test = useContractForm(ticketOrganizationSubjectSchema, subject);
  const save = useContractForm(eventTicketOrganizationDecisionSchema, {
    ...subject,
    ticketKey: ticketKey || undefined,
  });
  const nameOf = (key: string) =>
    draft && key === draft.input.key ? draft.name : (tickets.find((type) => type.key === key)?.name ?? key);
  const fallback = tickets.find((type) => type.isDefault) ?? tickets[0];

  // Counts edits to the organization, so an answer for an earlier one is dropped.
  const edits = useRef(0);
  function edited() {
    edits.current += 1;
    setAnswer(null);
  }

  async function runTest() {
    if (busy) return;
    const checked = test.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    const asked = edits.current;
    setBusy("testing");
    setError("");
    try {
      const body: EventTicketOrganizationTrial = { organizations: [checked.data], draft: draft?.input };
      const { results } = await postJson(
        `${ticketsEndpoint(slug)}/organizations/trials`,
        body,
        eventTicketOrganizationTrialResponseSchema,
      );
      const result = results[0];
      if (asked !== edits.current || !result) return;
      if (!result.answers) return setError("The classifier did not answer. Try again.");
      setAnswer(result);
      setTicketKey(result.decidedTicketKey ?? result.current?.ticketKey ?? result.answers[0]?.ticketKey ?? "");
    } catch (cause) {
      setError(test.refuse(cause));
    } finally {
      setBusy(null);
    }
  }

  async function saveDecision() {
    if (busy || !onSaved) return;
    const checked = save.submit();
    if (!checked.data) {
      // The organization fields show the test's checks, which hold the same rules.
      test.submit();
      return setError(checked.formMessage ?? "");
    }
    setBusy("saving");
    setError("");
    try {
      const body: EventTicketOrganizationDecisions = { decisions: [checked.data] };
      await postJson(`${ticketsEndpoint(slug)}/organizations/decisions`, body, successResponseSchema);
      await onSaved(nameOf(checked.data.ticketKey));
    } catch (cause) {
      setError(save.refuse(cause));
      setBusy(null);
    }
  }

  // Only the organization the dialog opened with is tested unasked: once, as it opens.
  const latestTest = useRef(runTest);
  latestTest.current = runTest;
  useEffect(() => {
    if (start.testOnOpen && classifierOn) void latestTest.current();
  }, [start.testOnOpen, classifierOn]);

  const percentOf = (key: string) => answer?.answers?.find((entry) => entry.ticketKey === key);
  const decided = answer?.decidedTicketKey ? percentOf(answer.decidedTicketKey) : undefined;
  const handlers = {
    onInput: (event: Event) => {
      test.handlers.onInput(event);
      save.handlers.onInput(event);
    },
    onChange: (event: Event) => {
      test.handlers.onChange(event);
      save.handlers.onChange(event);
    },
    onFocusOut: (event: Event) => {
      test.handlers.onFocusOut(event);
      save.handlers.onFocusOut(event);
    },
  };
  const noneDecides = `No ticket reaches its threshold. ${draft ? "People" : "Unless you save one, people"} from this organization choose a ticket or get ${fallback?.name ?? "the default ticket"}.`;
  return (
    <Dialog
      open
      title={
        draft
          ? `Test the ${draft.name || "new"} ticket`
          : !classifierOn
            ? "Choose an organization's ticket"
            : start.organizationName
              ? "Check an organization's ticket"
              : "Test an organization"
      }
      closeLabel="Close dialog"
      description={draft ? "Tests the description as you have it now. Nothing is saved." : undefined}
      confirmLabel={draft ? "Close" : ticketKey ? `Save ${nameOf(ticketKey)}` : "Save ticket"}
      confirmDisabled={!draft && busy !== null}
      cancelLabel={draft ? null : "Close"}
      onConfirm={() => (draft ? onClose() : void saveDecision())}
      onCancel={onClose}
    >
      <form
        noValidate
        class="pk-stack"
        {...handlers}
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          if (classifierOn) void runTest();
        }}
      >
        <Field {...test.of("organizationName")} label="Organization" required>
          {(control) => (
            <TextInput
              {...control}
              name="organizationName"
              value={organizationName}
              onInput={(event) => {
                setOrganizationName(event.currentTarget.value);
                edited();
              }}
            />
          )}
        </Field>
        <Field
          {...test.of("emailDomain")}
          label="Email domain"
          help="Optional. Personal mail domains are ignored, as at registration."
        >
          {(control) => (
            <TextInput
              {...control}
              name="emailDomain"
              value={emailDomain}
              placeholder="example.com"
              onInput={(event) => {
                setEmailDomain(event.currentTarget.value);
                edited();
              }}
            />
          )}
        </Field>
        {classifierOn ? (
          <div class="pk-cluster">
            <Button type="submit" variant="secondary" disabled={busy !== null}>
              {busy === "testing" ? "Testing…" : answer ? "Test again" : "Test"}
            </Button>
            {answer && emailDomain.trim() && !answer.emailDomain && (
              <span class="pk-small pk-muted">Personal mail domain: tested on the name alone.</span>
            )}
          </div>
        ) : (
          <p class="pk-small pk-muted">To test the classifier, describe who qualifies for at least two tickets.</p>
        )}
        {draft ? (
          answer && (
            <DescriptionList
              density="compact"
              items={(answer.answers ?? []).map((entry) => ({
                key: entry.ticketKey,
                term: nameOf(entry.ticketKey),
                value: `${String(entry.percent)}% sure, ${String(entry.thresholdPercent)}% needed`,
              }))}
            />
          )
        ) : (
          <Field {...save.ofGroup("ticketKey")} label="Ticket" group required>
            {() => (
              <div class="pk-stack pk-stack--tight">
                {tickets.map((type) => {
                  const entry = percentOf(type.key);
                  return (
                    <Radio
                      key={type.key}
                      name="ticketKey"
                      value={type.key}
                      checked={ticketKey === type.key}
                      label={type.name}
                      hint={entry ? `Classifier: ${String(entry.percent)}% sure` : undefined}
                      onChange={() => setTicketKey(type.key)}
                    />
                  );
                })}
              </div>
            )}
          </Field>
        )}
        {answer && (
          <p class="pk-small pk-muted">
            {answer.current?.ticketKey &&
              `Now ${nameOf(answer.current.ticketKey)}, decided ${decidedBy(answer.current)}. `}
            {decided && answer.decidedTicketKey
              ? `The classifier gives ${nameOf(answer.decidedTicketKey)}: ${String(decided.percent)}% sure, and ${String(decided.thresholdPercent)}% is enough.`
              : noneDecides}
          </p>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
