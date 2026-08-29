import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { z } from "zod";
import {
  groupEventFormCreateSchema,
  groupEventFormResponseSchema,
  groupEventFormUpdateSchema,
  groupEventFormsResponseSchema,
} from "../../../../../shared/schemas/group-event-forms";
import { groupFormDefinitionResponseSchema } from "../../../../../shared/schemas/group-forms";
import type {
  EventFormsPurpose,
  FormDefinitionCreateInput,
  FormDefinitionUpdateInput,
} from "../../../../../shared/schemas/forms";
import { FormDefinitionEditor, type EditableFormDetail } from "../../../../components/forms/FormDefinitionEditor";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { Spinner } from "../../../../components/Spinner";
import { getJson, postJson, putJson } from "../../../../shared/api-client";
import type { ServerCatalog } from "../../../../shared/server-catalog";
import { toast } from "../../ui";
import { GroupFormEditor } from "./GroupFormEditor";

type EventFormResponse = z.infer<typeof groupEventFormResponseSchema>;
type EventForm = z.infer<typeof groupEventFormsResponseSchema>["forms"][number];

function eventFormLabel(purpose: EventFormsPurpose): string {
  return purpose === "event_registration" ? "Registration questions" : "Proposal submission questions";
}

function eventFormCatalog(base: string): ServerCatalog<EventForm, z.infer<typeof groupEventFormsResponseSchema>> {
  return {
    endpoint: `${base}/available`,
    responseSchema: groupEventFormsResponseSchema,
    resolveItems: (response) => response.forms,
    resolvePage: (response) => response.page,
    itemKey: (form) => form.id,
    itemLabel: (form) => form.title,
    sort: "title",
  };
}

/** Shared event-flow form placement lifecycle for registration and proposal submissions. */
export function EventFormPlacementEditor({
  groupId,
  eventId,
  purpose,
  expectedUpdatedAt,
  onRevision,
}: {
  groupId: string;
  eventId: string;
  purpose: EventFormsPurpose;
  expectedUpdatedAt: string;
  onRevision: (updatedAt: string) => void;
}) {
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/forms/${purpose}`;
  const catalog = useMemo(() => eventFormCatalog(base), [base]);
  const [placement, setPlacement] = useState<EventFormResponse | null>(null);
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
      const response = await getJson(base, groupEventFormResponseSchema);
      setPlacement(response);
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

  async function savePlacement(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const input = groupEventFormUpdateSchema.parse({ expectedUpdatedAt, formId });
      const response = await putJson(base, input, groupEventFormResponseSchema);
      setPlacement(response);
      setFormId(response.form?.form.id ?? null);
      setFormLabel(response.form?.form.title);
      onRevision(response.eventUpdatedAt);
      toast(
        `${purpose === "event_registration" ? "Registration" : "Proposal submission"} form selection saved`,
        "success",
      );
    } catch (cause) {
      const message = (cause as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function createForm(payload: FormDefinitionCreateInput | FormDefinitionUpdateInput): Promise<string> {
    const input = groupEventFormCreateSchema.parse({ expectedUpdatedAt, definition: payload });
    const response = await postJson(base, input, groupEventFormResponseSchema);
    setPlacement(response);
    setFormId(response.form?.form.id ?? null);
    setFormLabel(response.form?.form.title);
    setCreating(false);
    onRevision(response.eventUpdatedAt);
    toast(`${purpose === "event_registration" ? "Registration" : "Proposal submission"} form created`, "success");
    return response.form?.form.key ?? input.definition.key;
  }

  async function openEditor(): Promise<void> {
    const attached = placement?.form;
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
  if (!placement && error) return <ErrorAlert error={error} />;
  if (!placement) return null;

  const currentFormId = placement.form?.form.id ?? null;
  const hasSelectionChange = formId !== currentFormId;
  const title = eventFormLabel(purpose);

  return (
    <div class="d-flex flex-column gap-2">
      <ServerSearchSelect
        catalog={catalog}
        label={title}
        value={formId}
        selectedLabel={formLabel}
        placeholder={`No ${purpose === "event_registration" ? "registration" : "proposal submission"} questions`}
        disabled={saving}
        onChange={(form) => {
          setFormId(form?.id ?? null);
          setFormLabel(form?.title);
        }}
      />
      <div class="d-flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-sm btn-success"
          disabled={saving || !hasSelectionChange}
          onClick={() => void savePlacement()}
        >
          {saving ? "Saving…" : `Save ${purpose === "event_registration" ? "registration" : "proposal"} form`}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          disabled={saving}
          aria-expanded={creating}
          onClick={() => setCreating((shown) => !shown)}
        >
          {creating
            ? "Cancel new form"
            : `Create ${purpose === "event_registration" ? "registration" : "proposal"} form`}
        </button>
        {placement.form && formId === currentFormId && (
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
          <div class="card-header fw-semibold">
            New {purpose === "event_registration" ? "registration" : "proposal submission"} form
          </div>
          <div class="card-body">
            <FormDefinitionEditor
              mode="create"
              detail={null}
              purposes={[purpose]}
              onSave={createForm}
              onSaved={() => undefined}
              onCancel={() => setCreating(false)}
              onError={(message) => setError(message)}
            />
          </div>
        </div>
      )}
      {editing && placement.form && (
        <div class="card">
          <div class="card-header fw-semibold">
            Edit {purpose === "event_registration" ? "registration" : "proposal submission"} form
          </div>
          <div class="card-body">
            <GroupFormEditor
              groupId={groupId}
              placementId={placement.form.placement.id}
              detail={editing}
              purposes={[purpose]}
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
