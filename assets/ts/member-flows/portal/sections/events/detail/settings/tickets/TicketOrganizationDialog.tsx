/**
 * Tests the classifier on one organization, as registration would ask it.
 * A portal organization is tested by its own name and domains, and the right
 * ticket can be saved as an organizer's decision. A typed organization shows
 * how the classifier treats a name and is never saved. A test stores
 * nothing; only Save does. From the ticket editor it tests the ticket's
 * unsaved "who gets this ticket".
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { postJson } from "../../../../../../../shared/api-client";
import { successResponseSchema } from "../../../../../../../../shared/schemas/api-common";
import type { EventTicketsConfiguration } from "../../../../../../../../shared/schemas/event-tickets";
import {
  eventTicketOrganizationDecisionSchema,
  eventTicketOrganizationTrialResponseSchema,
  ticketPortalOrganizationSubjectSchema,
  ticketTypedOrganizationSubjectSchema,
  type EventTicketClassifierDraft,
  type EventTicketOrganizationDecisions,
  type EventTicketOrganizationTrial,
  type EventTicketOrganizationTrialResult,
  type TicketOrganizationSubject,
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

/** What the dialog opens with: a portal organization, or an empty name to type. */
export interface TicketOrganizationStart {
  /** Set for a portal organization, whose name and domains are its own and whose ticket can be saved. */
  organizationId?: string;
  organizationName: string;
  domains: readonly string[];
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
  const portal = start.organizationId !== undefined;
  const [organizationName, setOrganizationName] = useState(start.organizationName);
  const [domains, setDomains] = useState(start.domains.join(", "));
  const [ticketKey, setTicketKey] = useState(start.ticketKey ?? "");
  const [answer, setAnswer] = useState<EventTicketOrganizationTrialResult | null>(null);
  const [busy, setBusy] = useState<"testing" | "saving" | null>(null);
  const [error, setError] = useState("");
  const typedDomains = domains.split(/[\s,]+/).filter(Boolean);
  // The dialog keeps the kind of organization it opened with, so the same schema checks it on every render.
  const subjectSchema: z.ZodType<TicketOrganizationSubject> = portal
    ? ticketPortalOrganizationSubjectSchema
    : ticketTypedOrganizationSubjectSchema;
  const test = useContractForm(
    subjectSchema,
    portal ? { organizationId: start.organizationId } : { organizationName, domains: typedDomains },
  );
  const save = useContractForm(eventTicketOrganizationDecisionSchema, {
    organizationId: start.organizationId,
    ticketKey: ticketKey || undefined,
  });
  // Only a portal organization's ticket is saved, and never from the ticket editor.
  const saves = portal && !draft && onSaved !== undefined;
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
      const body: EventTicketOrganizationTrial = {
        organizations: [checked.data],
        draft: draft?.input,
      };
      const { results } = await postJson(
        `${ticketsEndpoint(slug)}/organizations/trials`,
        body,
        eventTicketOrganizationTrialResponseSchema,
      );
      const result = results[0];
      if (asked !== edits.current || !result) return;
      if (result.error === "not_found")
        return setError("This organization is no longer in the portal. Reload the list.");
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
    if (busy || !onSaved || !saves) return;
    const checked = save.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
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
  const noneDecides = `No ticket reaches its threshold. ${saves ? "Unless you save one, people" : "People"} from this organization choose a ticket or get ${fallback?.name ?? "the default ticket"}.`;
  const leftOut = !portal && answer !== null && typedDomains.length > answer.domains.length;
  return (
    <Dialog
      open
      title={
        draft
          ? `Test the ${draft.name || "new"} ticket`
          : !portal
            ? "Test an organization"
            : classifierOn
              ? "Check an organization's ticket"
              : "Choose an organization's ticket"
      }
      closeLabel="Close dialog"
      description={
        draft
          ? "Tests the description as you have it now. Nothing is saved."
          : portal
            ? undefined
            : "Shows how the classifier treats a name. To save a ticket, find the organization in the portal."
      }
      confirmLabel={!saves ? "Close" : ticketKey ? `Save ${nameOf(ticketKey)}` : "Save ticket"}
      confirmDisabled={saves && busy !== null}
      cancelLabel={saves ? "Close" : null}
      onConfirm={() => (saves ? void saveDecision() : onClose())}
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
        {portal ? (
          <DescriptionList
            density="compact"
            items={[
              { term: "Organization", value: start.organizationName },
              { term: "Domains", value: start.domains.join(", ") || "None recognized" },
            ]}
          />
        ) : (
          <>
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
              {...test.of("domains")}
              label="Domains"
              help="Optional. Separate several with commas. Personal mail domains are ignored, as at registration."
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="domains"
                  value={domains}
                  placeholder="example.com"
                  onInput={(event) => {
                    setDomains(event.currentTarget.value);
                    edited();
                  }}
                />
              )}
            </Field>
          </>
        )}
        {classifierOn ? (
          <div class="pk-cluster">
            <Button type="submit" variant="secondary" disabled={busy !== null}>
              {busy === "testing" ? "Testing…" : answer ? "Test again" : "Test"}
            </Button>
            {leftOut && <span class="pk-small pk-muted">Personal mail domains were left out of the test.</span>}
          </div>
        ) : (
          <p class="pk-small pk-muted">To test the classifier, describe who qualifies for at least two tickets.</p>
        )}
        {!saves ? (
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
