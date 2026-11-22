/**
 * Whether a PKIC-wide check runs, on which model, and the context every
 * question is read against: what PKIC is, who takes part, what counts as
 * abuse or promotion. Events add their own context below it.
 */
import { useState } from "preact/hooks";
import { CONTENT_CHECK_MODEL_LABELS, CONTENT_CHECK_MODELS } from "../../../../../shared/content-checks";
import {
  contentCheckSettingsInputSchema,
  type ContentCheckSettingsInput,
  type ContentCheckSettingsResponse,
} from "../../../../../shared/schemas/content-checks";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { useContractForm } from "../../../../hooks/useContractForm";
import { Checkbox } from "../../../../ui/Checkbox";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { EditActions } from "../../../../ui/EditActions";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, Textarea } from "../../../../ui/TextControl";

export function ContentCheckBasics({
  settings,
  canWrite,
  onSave,
}: {
  settings: ContentCheckSettingsResponse;
  canWrite: boolean;
  onSave: (patch: Pick<ContentCheckSettingsInput, "enabled" | "model" | "context">) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ enabled: settings.enabled, model: settings.model, context: settings.context });
  const form = useContractForm(contentCheckSettingsInputSchema, {
    expectedRevision: settings.revision,
    questions: settings.questions,
    ...draft,
  });

  function reset() {
    setDraft({ enabled: settings.enabled, model: settings.model, context: settings.context });
    setError("");
    form.reset();
  }

  async function save(event: Event) {
    event.preventDefault();
    if (!editing || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      setEditing(false);
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate {...form.handlers} onSubmit={(event) => void save(event)} autocomplete="off">
      <Panel>
        <PanelHeader title="Check">
          {canWrite && (
            <EditActions
              label="Check actions"
              editing={editing}
              saving={saving}
              onEdit={() => {
                reset();
                setEditing(true);
              }}
              onCancel={() => {
                reset();
                setEditing(false);
              }}
            />
          )}
        </PanelHeader>
        <PanelBody class="pk-stack">
          {editing ? (
            <>
              <Checkbox
                name="enabled"
                checked={draft.enabled}
                disabled={saving}
                onChange={(event) => setDraft({ ...draft, enabled: event.currentTarget.checked })}
                label="Check new content automatically"
              />
              <Field {...form.of("model")} label="Model">
                {(control) => (
                  <Select
                    {...control}
                    name="model"
                    value={draft.model}
                    disabled={saving}
                    onChange={(event) => setDraft({ ...draft, model: event.currentTarget.value as typeof draft.model })}
                  >
                    {CONTENT_CHECK_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {CONTENT_CHECK_MODEL_LABELS[model]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                {...form.of("context")}
                label="Context"
                help="What the model needs to know to answer: who PKIC is, who takes part, and the rules that apply. Events add their own."
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="context"
                    rows={8}
                    value={draft.context}
                    disabled={saving}
                    onInput={(event) => setDraft({ ...draft, context: event.currentTarget.value })}
                  />
                )}
              </Field>
            </>
          ) : (
            <DescriptionList
              items={[
                { term: "Status", value: settings.enabled ? "On" : "Off" },
                { term: "Model", value: CONTENT_CHECK_MODEL_LABELS[settings.model] },
                {
                  term: "Context",
                  value: settings.context ? <p class="pk-prose-block">{settings.context}</p> : "None",
                },
              ]}
            />
          )}
          <ErrorAlert error={error} />
        </PanelBody>
      </Panel>
    </form>
  );
}
