/** Add or change one ticket: its name, what people read about it, and who gets it. */
import { useState } from "preact/hooks";
import { postJson, putJson } from "../../../../../../../shared/api-client";
import {
  eventTicketTypeInputSchema,
  eventTicketsChangeResponseSchema,
  type EventTicketType,
} from "../../../../../../../../shared/schemas/event-tickets";
import { MarkdownEditor } from "../../../../../../../components/markdown-editor/MarkdownInput";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../../ui/Alert";
import { Button } from "../../../../../../../ui/Button";
import { Checkbox } from "../../../../../../../ui/Checkbox";
import { Field } from "../../../../../../../ui/Field";
import { FormSection } from "../../../../../../../ui/FormSection";
import { Panel, PanelBody, PanelHeader } from "../../../../../../../ui/Panel";
import { Select, TextInput, Textarea } from "../../../../../../../ui/TextControl";
import { EVENT_TICKET_STARTERS } from "../../../../../../../../shared/event-ticket-starters";
import { DEFAULT_CLASSIFIER_THRESHOLD } from "../../../../../../../../shared/event-tickets";
import { ticketsEndpoint } from "./tickets-endpoint";

export function TicketTypeEditor({
  slug,
  revision,
  type,
  firstTicket,
  onSaved,
  onCancel,
}: {
  slug: string;
  revision: number;
  type?: EventTicketType;
  /** The first ticket of an event is its default. */
  firstTicket: boolean;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(type?.name ?? "");
  const [key, setKey] = useState(type?.key ?? "");
  const [description, setDescription] = useState(type?.descriptionMarkdown ?? "");
  const [classifier, setClassifier] = useState(type?.classifierDescription ?? "");
  const [threshold, setThreshold] = useState(
    String(type?.classifierThresholdPercent ?? Math.round(DEFAULT_CLASSIFIER_THRESHOLD * 100)),
  );
  const [isDefault, setIsDefault] = useState(type?.isDefault ?? firstTicket);
  const [workEmail, setWorkEmail] = useState(type?.freeRequiresWorkEmail ?? false);
  const [active, setActive] = useState(type?.active ?? true);
  const [starterRevision, setStarterRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(eventTicketTypeInputSchema, {
    expectedRevision: revision,
    key,
    name,
    descriptionMarkdown: description,
    classifierDescription: classifier,
    classifierThresholdPercent: threshold.trim() === "" ? undefined : Number(threshold),
    isDefault,
    freeRequiresWorkEmail: workEmail,
    active,
  });
  function startFrom(starterKey: string) {
    const starter = EVENT_TICKET_STARTERS.find((candidate) => candidate.key === starterKey);
    setName(starter?.name ?? "");
    setKey(starter?.key ?? "");
    setDescription(starter?.descriptionMarkdown ?? "");
    setClassifier(starter?.classifierDescription ?? "");
    setIsDefault(starter?.isDefault ?? firstTicket);
    setWorkEmail(starter?.freeRequiresWorkEmail ?? false);
    // The Markdown editor reads its text once, when it mounts.
    setStarterRevision((current) => current + 1);
    form.reset();
  }
  async function save(submitEvent: Event) {
    submitEvent.preventDefault();
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      if (type)
        await putJson(
          `${ticketsEndpoint(slug)}/types/${encodeURIComponent(type.id)}`,
          checked.data,
          eventTicketsChangeResponseSchema,
        );
      else await postJson(`${ticketsEndpoint(slug)}/types`, checked.data, eventTicketsChangeResponseSchema);
      await onSaved();
    } catch (cause) {
      setError(form.refuse(cause));
      setSaving(false);
    }
  }
  return (
    <Panel aria-label={type ? `Edit ${type.name}` : "Add ticket"}>
      <form noValidate {...form.handlers} onSubmit={(submitEvent) => void save(submitEvent)}>
        <PanelHeader title={type ? `Edit ${type.name}` : "Add ticket"}>
          <Button type="button" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={saving}>
            {type ? "Save ticket" : "Add ticket"}
          </Button>
        </PanelHeader>
        <PanelBody class="pk-stack pk-stack--loose">
          {!type && (
            <Field label="Start from" help="A starting point you can change before you add the ticket.">
              {(control) => (
                <Select {...control} name="starter" onChange={(event) => startFrom(event.currentTarget.value)}>
                  <option value="">An empty ticket</option>
                  {EVENT_TICKET_STARTERS.map((starter) => (
                    <option key={starter.key} value={starter.key}>
                      {starter.name} ({starter.key})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <FormSection title="What people see">
            <Field {...form.of("name")} label="Name" required>
              {(control) => (
                <TextInput
                  {...control}
                  name="name"
                  value={name}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              )}
            </Field>
            <Field
              {...form.of("descriptionMarkdown")}
              label="Description"
              help="Shown on the ticket when people register. Say who it is for and what it includes."
            >
              {(control) => (
                <MarkdownEditor
                  key={starterRevision}
                  {...control}
                  name="descriptionMarkdown"
                  label="Description"
                  variant="compact"
                  initialValue={description}
                  onChange={setDescription}
                />
              )}
            </Field>
          </FormSection>
          <FormSection title="Who gets this ticket">
            <Field
              {...form.of("classifierDescription")}
              label="Organizations that qualify"
              help="Each organization is matched once against the descriptions of this event's tickets. Describe the organization, not the person: what it sells, runs or does, and the edge cases. Leave empty for a ticket that is only given with a code."
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="classifierDescription"
                  rows={6}
                  value={classifier}
                  onInput={(event) => setClassifier(event.currentTarget.value)}
                />
              )}
            </Field>
            <Field
              {...form.of("classifierThresholdPercent")}
              label="Certainty needed (%)"
              help="Below this certainty the person chooses their ticket themselves."
              required
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="classifierThresholdPercent"
                  type="number"
                  inputMode="numeric"
                  value={threshold}
                  onInput={(event) => setThreshold(event.currentTarget.value)}
                />
              )}
            </Field>
            <Checkbox
              name="isDefault"
              checked={isDefault}
              label="Give this ticket when nothing else decides"
              hint="One ticket per event. Choosing this one takes it from the other."
              onChange={(event) => setIsDefault(event.currentTarget.checked)}
            />
            <Checkbox
              name="freeRequiresWorkEmail"
              checked={workEmail}
              label="A free ticket needs a work email address"
              hint="While this ticket is free, a personal address such as Gmail pays its first paid price."
              onChange={(event) => setWorkEmail(event.currentTarget.checked)}
            />
          </FormSection>
          <FormSection title="Reuse">
            <Field
              {...form.of("key")}
              label="Key"
              help="Stays the same across events, such as pqcc_vendor. An event that uses the same key and description reuses the decisions already made for organizations."
              required
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="key"
                  autocomplete="off"
                  value={key}
                  onInput={(event) => setKey(event.currentTarget.value)}
                />
              )}
            </Field>
            <Checkbox
              name="active"
              checked={active}
              label="Offer this ticket"
              hint="Turn off to stop new registrations with it. Tickets already issued stay valid."
              onChange={(event) => setActive(event.currentTarget.checked)}
            />
          </FormSection>
          {error && <Alert tone="danger">{error}</Alert>}
        </PanelBody>
      </form>
    </Panel>
  );
}
