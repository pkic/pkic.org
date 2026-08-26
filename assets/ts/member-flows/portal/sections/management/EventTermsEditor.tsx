import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  groupEventTermsReplaceResponseSchema,
  groupEventTermsResponseSchema,
  type GroupEvent,
} from "../../../../../shared/schemas/group-events";
import type { EventTermsReplaceInput } from "../../../../../shared/schemas/event-configuration";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { FormActions } from "../../../../components/FormActions";
import { useData } from "../../../../hooks/useData";
import { getJson, putJson } from "../../../../shared/api-client";

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

function TermRow({
  idPrefix,
  term,
  onChange,
  onRemove,
}: {
  idPrefix: string;
  term: TermInput;
  onChange: (term: TermInput) => void;
  onRemove: () => void;
}) {
  const update = (patch: Partial<TermInput>) => onChange({ ...term, ...patch });
  return (
    <div class="card border mb-2">
      <div class="card-body py-2 px-3">
        <div class="row g-2 mb-2">
          <div class="col-md-3">
            <label class="form-label small mb-1" for={`${idPrefix}-key`}>
              Key
            </label>
            <input
              id={`${idPrefix}-key`}
              class="form-control form-control-sm"
              autocomplete="off"
              value={term.termKey}
              onInput={(event) => update({ termKey: event.currentTarget.value })}
              placeholder="terms-of-service"
              required
            />
          </div>
          <div class="col-md-2">
            <label class="form-label small mb-1" for={`${idPrefix}-version`}>
              Version
            </label>
            <input
              id={`${idPrefix}-version`}
              class="form-control form-control-sm"
              autocomplete="off"
              value={term.version}
              onInput={(event) => update({ version: event.currentTarget.value })}
              required
            />
          </div>
          <div class="col-md-5">
            <label class="form-label small mb-1" for={`${idPrefix}-content-ref`}>
              Link URL
            </label>
            <input
              id={`${idPrefix}-content-ref`}
              class="form-control form-control-sm"
              type="url"
              autocomplete="off"
              value={term.contentRef ?? ""}
              onInput={(event) => update({ contentRef: event.currentTarget.value || undefined })}
              placeholder="https://…"
            />
          </div>
          <div class="col-md-1 d-flex align-items-end">
            <label class="form-check mb-1">
              <input
                id={`${idPrefix}-required`}
                class="form-check-input"
                type="checkbox"
                checked={term.required}
                onChange={(event) => update({ required: event.currentTarget.checked })}
              />
              <span class="form-check-label small">Required</span>
            </label>
          </div>
          <div class="col-md-1 d-flex align-items-end">
            <button type="button" class="btn btn-sm btn-outline-danger" onClick={onRemove} aria-label="Remove term">
              Remove
            </button>
          </div>
        </div>
        <div class="row g-2">
          <div class="col-md-6">
            <label class="form-label small mb-1" for={`${idPrefix}-display-text`}>
              Agreement text
            </label>
            <input
              id={`${idPrefix}-display-text`}
              class="form-control form-control-sm"
              autocomplete="off"
              value={term.displayText}
              onInput={(event) => update({ displayText: event.currentTarget.value })}
              placeholder="I agree to the event terms"
              required
            />
          </div>
          <div class="col-md-6">
            <label class="form-label small mb-1" for={`${idPrefix}-help-text`}>
              Help text
            </label>
            <input
              id={`${idPrefix}-help-text`}
              class="form-control form-control-sm"
              autocomplete="off"
              value={term.helpText ?? ""}
              onInput={(event) => update({ helpText: event.currentTarget.value || undefined })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function AudienceTerms({
  audience,
  label,
  terms,
  onChange,
  open,
  idPrefix,
}: {
  audience: Audience;
  label: string;
  terms: TermInput[];
  onChange: (terms: TermInput[]) => void;
  open?: boolean;
  idPrefix: string;
}) {
  return (
    <details class="border rounded p-2 mb-2" open={open}>
      <summary class="fw-semibold small">
        {label} <span class="text-muted">({terms.length})</span>
      </summary>
      <div class="pt-2">
        {terms.map((term, index) => (
          <TermRow
            key={`${audience}-${term.termKey}-${index}`}
            idPrefix={`${idPrefix}-${audience}-${index}`}
            term={term}
            onChange={(next) =>
              onChange(terms.map((current, currentIndex) => (currentIndex === index ? next : current)))
            }
            onRemove={() => onChange(terms.filter((_, currentIndex) => currentIndex !== index))}
          />
        ))}
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          onClick={() => onChange([...terms, emptyTerm()])}
        >
          Add {label.toLowerCase()} term
        </button>
      </div>
    </details>
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
    <form onSubmit={(event) => void submit(event)}>
      <ErrorAlert error={error} />
      <AudienceTerms
        audience="attendee"
        label="Attendee"
        idPrefix={event.id}
        terms={terms.attendee}
        onChange={(attendee) => setTerms({ ...terms, attendee })}
        open
      />
      <AudienceTerms
        audience="speaker"
        label="Speaker"
        idPrefix={event.id}
        terms={terms.speaker}
        onChange={(speaker) => setTerms({ ...terms, speaker })}
      />
      <AudienceTerms
        audience="presentation"
        label="Presentation upload"
        idPrefix={event.id}
        terms={terms.presentation}
        onChange={(presentation) => setTerms({ ...terms, presentation })}
      />
      <FormActions
        submitLabel="Save terms"
        busyLabel="Saving terms…"
        busy={saving}
        onCancel={() => void reload()}
        status={status}
        submitVariant="primary"
      />
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
  if (resource.loading) return <p class="small text-muted">Loading terms…</p>;
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
