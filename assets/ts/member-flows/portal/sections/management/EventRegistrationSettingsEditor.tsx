import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { z } from "zod";
import {
  groupEventRegistrationFormCreateSchema,
  groupEventRegistrationFormsResponseSchema,
  groupEventRegistrationSettingsResponseSchema,
  groupEventRegistrationSettingsUpdateSchema,
} from "../../../../../shared/schemas/group-events";
import { groupFormDefinitionResponseSchema } from "../../../../../shared/schemas/group-forms";
import {
  EVENT_REGISTRATION_POLICIES,
  EVENT_REGISTRATION_POLICY_LABELS,
  type EventRegistrationPolicy,
} from "../../../../../shared/schemas/event-series";
import type { FormDefinitionCreateInput, FormDefinitionUpdateInput } from "../../../../../shared/schemas/forms";
import { FormDefinitionEditor, type EditableFormDetail } from "../../../../components/forms/FormDefinitionEditor";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { getJson, postJson, putJson } from "../../../../shared/api-client";
import type { ServerCatalog } from "../../../../shared/server-catalog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { toast } from "../../ui";
import { GroupFormEditor } from "./GroupFormEditor";

type RegistrationSettings = z.infer<typeof groupEventRegistrationSettingsResponseSchema>;
type RegistrationForm = z.infer<typeof groupEventRegistrationFormsResponseSchema>["forms"][number];

function registrationFormCatalog(
  base: string,
): ServerCatalog<RegistrationForm, z.infer<typeof groupEventRegistrationFormsResponseSchema>> {
  return {
    endpoint: `${base}/forms`,
    responseSchema: groupEventRegistrationFormsResponseSchema,
    resolveItems: (response) => response.forms,
    resolvePage: (response) => response.page,
    itemKey: (form) => form.id,
    itemLabel: (form) => form.title,
    sort: "title",
  };
}

export function EventRegistrationSettingsEditor({
  groupId,
  eventId,
  expectedUpdatedAt,
  onRevision,
}: {
  groupId: string;
  eventId: string;
  expectedUpdatedAt: string;
  onRevision: (updatedAt: string) => void;
}) {
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registration-settings`;
  const catalog = useMemo(() => registrationFormCatalog(base), [base]);
  const [settings, setSettings] = useState<RegistrationSettings | null>(null);
  const [registrationPolicy, setRegistrationPolicy] = useState<EventRegistrationPolicy>("no_registration");
  const [formId, setFormId] = useState<string | null>(null);
  const [formLabel, setFormLabel] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EditableFormDetail | null>(null);
  const [loadingEditor, setLoadingEditor] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getJson(base, groupEventRegistrationSettingsResponseSchema);
      setSettings(response);
      setRegistrationPolicy(response.registrationPolicy);
      setFormId(response.form?.form.id ?? null);
      setFormLabel(response.form?.form.title);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const input = groupEventRegistrationSettingsUpdateSchema.parse({
        expectedUpdatedAt,
        registrationPolicy,
        formId,
      });
      const response = await putJson(base, input, groupEventRegistrationSettingsResponseSchema);
      setSettings(response);
      setRegistrationPolicy(response.registrationPolicy);
      setFormId(response.form?.form.id ?? null);
      setFormLabel(response.form?.form.title);
      onRevision(response.eventUpdatedAt);
      toast("Registration settings saved", "success");
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function createForm(payload: FormDefinitionCreateInput | FormDefinitionUpdateInput): Promise<string> {
    const input = groupEventRegistrationFormCreateSchema.parse(payload);
    const response = await postJson(`${base}/form`, input, groupEventRegistrationSettingsResponseSchema);
    setSettings(response);
    setFormId(response.form?.form.id ?? null);
    setFormLabel(response.form?.form.title);
    setCreating(false);
    onRevision(response.eventUpdatedAt);
    toast("Registration form created", "success");
    return response.form?.form.key ?? input.key;
  }

  async function openEditor(): Promise<void> {
    const attached = settings?.form;
    if (!attached) return;
    setLoadingEditor(true);
    setError(null);
    try {
      const response = await getJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/forms/${encodeURIComponent(attached.placement.id)}`,
        groupFormDefinitionResponseSchema,
      );
      setEditing({
        form: {
          key: response.form.key,
          purpose: response.form.purpose,
          title: response.form.title,
          description: response.form.description,
          status: response.form.status,
        },
        fields: response.fields,
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoadingEditor(false);
    }
  }

  if (loading) return <Spinner />;
  if (!settings && error) return <ErrorAlert error={error} />;
  if (!settings) return null;

  return (
    <div class="d-flex flex-column gap-3">
      <p class="small text-muted mb-0">
        Enable registration after configuring at least one required attendee term. Custom registration questions are
        optional.
      </p>
      <div>
        <label class="form-label small fw-semibold" for={`event-registration-policy-${eventId}`}>
          Registration policy
        </label>
        <select
          id={`event-registration-policy-${eventId}`}
          class="form-select form-select-sm"
          value={registrationPolicy}
          disabled={saving}
          onChange={(event) => setRegistrationPolicy(event.currentTarget.value as EventRegistrationPolicy)}
        >
          {EVENT_REGISTRATION_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {EVENT_REGISTRATION_POLICY_LABELS[policy]}
            </option>
          ))}
        </select>
      </div>
      <ServerSearchSelect
        catalog={catalog}
        label="Registration questions"
        value={formId}
        selectedLabel={formLabel}
        placeholder="No custom registration questions"
        disabled={saving}
        onChange={(form) => {
          setFormId(form?.id ?? null);
          setFormLabel(form?.title);
        }}
      />
      <div class="d-flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm btn-success" disabled={saving} onClick={() => void saveSettings()}>
          {saving ? "Saving…" : "Save registration settings"}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          disabled={saving}
          aria-expanded={creating}
          onClick={() => setCreating((shown) => !shown)}
        >
          {creating ? "Cancel new form" : "Create registration form"}
        </button>
        {settings.form && formId === settings.form.form.id && (
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary"
            disabled={saving || loadingEditor}
            aria-expanded={editing !== null}
            onClick={() => (editing ? setEditing(null) : void openEditor())}
          >
            {loadingEditor ? "Loading form…" : editing ? "Close form editor" : "Edit attached form"}
          </button>
        )}
      </div>
      {error && <ErrorAlert error={error} />}
      {creating && (
        <div class="card">
          <div class="card-header fw-semibold">New registration form</div>
          <div class="card-body">
            <FormDefinitionEditor
              mode="create"
              detail={null}
              purposes={["event_registration"]}
              onSave={createForm}
              onSaved={() => undefined}
              onCancel={() => setCreating(false)}
              onError={(message) => setError(message)}
            />
          </div>
        </div>
      )}
      {editing && settings.form && (
        <div class="card">
          <div class="card-header fw-semibold">Edit registration form</div>
          <div class="card-body">
            <GroupFormEditor
              groupId={groupId}
              placementId={settings.form.placement.id}
              detail={editing}
              purposes={["event_registration"]}
              onSaved={async () => {
                setEditing(null);
                await load();
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
