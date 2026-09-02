import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  groupEventTermsReplaceResponseSchema,
  groupEventTermsResponseSchema,
  type GroupEvent,
} from "../../../../../shared/schemas/group-events";
import type { EventTermsReplaceInput } from "../../../../../shared/schemas/event-configuration";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Alert } from "../../../../ui/Alert";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput } from "../../../../ui/TextControl";
import { useData } from "../../../../hooks/useData";
import { getJson, putJson } from "../../../../shared/api-client";

// `pk-mono` — the term key and its version are identifiers, and Content.css
// rides a lazy chunk rather than the entry stylesheet.
import "../../../../ui/Content.css";

type TermsResponse = z.infer<typeof groupEventTermsResponseSchema>;
type TermInput = EventTermsReplaceInput["attendee"][number];
type Audience = keyof EventTermsReplaceInput;

function path(groupId: string, eventId: string): string {
  return `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/terms`;
}

function emptyTerm(): TermInput {
  return { termKey: "", version: "1.0", required: true, displayText: "" };
}

function toInput(term: TermsResponse["terms"][Audience][number]): TermInput {
  return {
    termKey: term.term_key,
    version: term.version,
    required: Boolean(term.required),
    contentRef: term.content_ref ?? undefined,
    displayText: term.display_text ?? "",
    helpText: term.help_text ?? undefined,
  };
}

/**
 * One term.
 *
 * The remove control names the audience and the ordinal rather than saying
 * "Remove" alone: an event can carry forty of these across three audiences,
 * and forty identically named buttons are indistinguishable to anyone reading
 * the form control by control.
 */
function TermRow({
  audienceLabel,
  ordinal,
  term,
  onChange,
  onRemove,
}: {
  audienceLabel: string;
  ordinal: number;
  term: TermInput;
  onChange: (term: TermInput) => void;
  onRemove: () => void;
}) {
  const update = (patch: Partial<TermInput>) => onChange({ ...term, ...patch });
  return (
    <div class="pk-stack pk-stack--tight">
      <div class="pk-grid pk-grid--tight">
        <Field label="Key" required help="Stored with the acceptance, such as terms-of-service.">
          {(control) => (
            <TextInput
              {...control}
              class="pk-mono"
              autocomplete="off"
              value={term.termKey}
              onInput={(event) => update({ termKey: event.currentTarget.value })}
              placeholder="terms-of-service"
            />
          )}
        </Field>
        <Field label="Version" required help="Raise it when the wording changes, so past acceptances stay meaningful.">
          {(control) => (
            <TextInput
              {...control}
              class="pk-mono"
              autocomplete="off"
              value={term.version}
              onInput={(event) => update({ version: event.currentTarget.value })}
            />
          )}
        </Field>
        <Field label="Link URL" help="The full text, if it lives on a page of its own.">
          {(control) => (
            <TextInput
              {...control}
              type="url"
              autocomplete="off"
              value={term.contentRef ?? ""}
              onInput={(event) => update({ contentRef: event.currentTarget.value || undefined })}
              placeholder="https://…"
            />
          )}
        </Field>
      </div>

      <div class="pk-grid pk-grid--roomy">
        <Field label="Agreement text" required help="The sentence beside the checkbox.">
          {(control) => (
            <TextInput
              {...control}
              autocomplete="off"
              value={term.displayText}
              onInput={(event) => update({ displayText: event.currentTarget.value })}
              placeholder="I agree to the event terms"
            />
          )}
        </Field>
        <Field label="Help text" help="Optional detail shown under the agreement.">
          {(control) => (
            <TextInput
              {...control}
              autocomplete="off"
              value={term.helpText ?? ""}
              onInput={(event) => update({ helpText: event.currentTarget.value || undefined })}
            />
          )}
        </Field>
      </div>

      <div class="pk-cluster">
        <Checkbox
          checked={term.required}
          onChange={(event) => update({ required: event.currentTarget.checked })}
          label="Required to complete registration"
        />
        <Button size="sm" variant="danger-quiet" onClick={onRemove}>
          Remove {audienceLabel.toLowerCase()} term {ordinal}
        </Button>
      </div>
    </div>
  );
}

/**
 * The terms one audience has to accept.
 *
 * The Bootstrap version nested a `<details>` inside the disclosure that
 * already wraps this whole editor, and its summary emitted no heading. A Panel
 * per audience puts a real heading in the outline instead, and the count is
 * spelled out rather than left as a bare number in brackets.
 */
function AudienceTerms({
  audience,
  label,
  terms,
  onChange,
}: {
  audience: Audience;
  label: string;
  terms: TermInput[];
  onChange: (terms: TermInput[]) => void;
}) {
  return (
    <Panel>
      <PanelHeader title={`${label} terms`}>
        <Badge tone="neutral">
          {terms.length} {terms.length === 1 ? "term" : "terms"}
        </Badge>
      </PanelHeader>
      <PanelBody class="pk-stack">
        {terms.length === 0 && (
          <EmptyState
            title={`No ${label.toLowerCase()} terms`}
            body="Nothing has to be accepted by this audience yet."
          />
        )}
        {terms.map((term, index) => (
          <TermRow
            key={`${audience}-${term.termKey}-${index}`}
            audienceLabel={label}
            ordinal={index + 1}
            term={term}
            onChange={(next) =>
              onChange(terms.map((current, currentIndex) => (currentIndex === index ? next : current)))
            }
            onRemove={() => onChange(terms.filter((_, currentIndex) => currentIndex !== index))}
          />
        ))}
        <div class="pk-cluster">
          <Button size="sm" onClick={() => onChange([...terms, emptyTerm()])}>
            Add {label.toLowerCase()} term
          </Button>
        </div>
      </PanelBody>
    </Panel>
  );
}

function TermsForm({
  groupId,
  event,
  response,
  expectedUpdatedAt,
  onRevision,
  reload,
}: {
  groupId: string;
  event: GroupEvent;
  response: TermsResponse;
  expectedUpdatedAt: string;
  onRevision: (updatedAt: string) => void;
  reload: () => Promise<void>;
}) {
  const [terms, setTerms] = useState<EventTermsReplaceInput>({
    attendee: response.terms.attendee.map(toInput),
    speaker: response.terms.speaker.map(toInput),
    presentation: response.terms.presentation.map(toInput),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function submit(submitEvent: Event): Promise<void> {
    submitEvent.preventDefault();
    setSaving(true);
    setError(null);
    setStatus("");
    try {
      const result = await putJson(
        path(groupId, event.id),
        { expectedUpdatedAt, configuration: terms },
        groupEventTermsReplaceResponseSchema,
      );
      onRevision(result.eventUpdatedAt);
      setStatus("Terms saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save event terms.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="pk pk-stack" onSubmit={(event) => void submit(event)}>
      <ErrorAlert error={error} />
      {/* One disabled fieldset takes the whole form out of play while the save
          is in flight, rather than each control deciding for itself. */}
      <fieldset class="pk-fieldset pk-stack" disabled={saving}>
        <AudienceTerms
          audience="attendee"
          label="Attendee"
          terms={terms.attendee}
          onChange={(attendee) => setTerms({ ...terms, attendee })}
        />
        <AudienceTerms
          audience="speaker"
          label="Speaker"
          terms={terms.speaker}
          onChange={(speaker) => setTerms({ ...terms, speaker })}
        />
        <AudienceTerms
          audience="presentation"
          label="Presentation upload"
          terms={terms.presentation}
          onChange={(presentation) => setTerms({ ...terms, presentation })}
        />

        <div class="pk-cluster">
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            {saving ? "Saving terms…" : "Save terms"}
          </Button>
          <Button size="sm" onClick={() => void reload()}>
            Cancel
          </Button>
        </div>
      </fieldset>

      {status && <Alert tone="ok">{status}</Alert>}
    </form>
  );
}

export function EventTermsEditor({
  groupId,
  event,
  expectedUpdatedAt,
  onRevision,
}: {
  groupId: string;
  event: GroupEvent;
  expectedUpdatedAt: string;
  onRevision: (updatedAt: string) => void;
}) {
  const resource = useData(() => getJson(path(groupId, event.id), groupEventTermsResponseSchema), [groupId, event.id]);
  if (resource.loading) return <Spinner label="Loading terms…" />;
  if (resource.error) return <ErrorAlert error={resource.error} />;
  if (!resource.data) return <></>;
  return (
    <TermsForm
      key={resource.data.eventUpdatedAt}
      groupId={groupId}
      event={event}
      response={resource.data}
      expectedUpdatedAt={expectedUpdatedAt}
      onRevision={onRevision}
      reload={resource.reload}
    />
  );
}
