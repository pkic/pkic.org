/**
 * What an event tells the model on top of the PKIC-wide context: its topics
 * and tracks, its audience, and the terms that apply this year.
 */
import { useState } from "preact/hooks";
import {
  classifierEventAdditionsInputSchema,
  type EventClassifierResponse,
} from "../../../../../shared/schemas/classifiers";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { useContractForm } from "../../../../hooks/useContractForm";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { EditActions } from "../../../../ui/EditActions";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Textarea } from "../../../../ui/TextControl";

export function EventClassifierContext({
  check,
  canEdit,
  onSave,
}: {
  check: EventClassifierResponse;
  canEdit: boolean;
  onSave: (context: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [context, setContext] = useState(check.additions.context);
  const form = useContractForm(classifierEventAdditionsInputSchema, {
    expectedRevision: check.additions.revision,
    ...check.additions,
    context,
  });

  function reset() {
    setContext(check.additions.context);
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
      await onSave(checked.data.context);
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
        <PanelHeader title="Context">
          {canEdit && (
            <EditActions
              label="Context actions"
              editLabel="Edit context"
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
            <Field
              {...form.of("context")}
              label="This event"
              help="Added after the PKIC-wide context: the event's topics and tracks, its audience, and this year's terms."
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="context"
                  rows={8}
                  value={context}
                  disabled={saving}
                  onInput={(event) => setContext(event.currentTarget.value)}
                />
              )}
            </Field>
          ) : (
            <DescriptionList
              items={[
                {
                  term: "PKIC-wide",
                  value: check.settings.context ? (
                    <p class="pk-prose-block pk-muted">{check.settings.context}</p>
                  ) : (
                    "None"
                  ),
                },
                {
                  term: "This event",
                  value: check.additions.context ? <p class="pk-prose-block">{check.additions.context}</p> : "None",
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
