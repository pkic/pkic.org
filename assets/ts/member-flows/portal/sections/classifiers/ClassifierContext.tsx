/**
 * The context one scope adds for the model, on top of what the scope below it
 * says: all content's on its own, a kind's after it, an event's after the
 * PKIC-wide context.
 */
import { useState } from "preact/hooks";
import type { z } from "zod";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { useContractForm } from "../../../../hooks/useContractForm";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { EditActions } from "../../../../ui/EditActions";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Textarea } from "../../../../ui/TextControl";

export function ClassifierContext<Schema extends z.ZodType>({
  schema,
  bodyFor,
  context: saved,
  term,
  help,
  below,
  canEdit,
  onSave,
}: {
  /** The contract the save is parsed with, and the body it parses for a given context. */
  schema: Schema;
  bodyFor: (context: string) => unknown;
  context: string;
  /** What this scope is called beside the context below it. */
  term: string;
  help: string;
  /** The context this scope comes after, shown when there is one. */
  below?: { term: string; context: string };
  canEdit: boolean;
  onSave: (context: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [context, setContext] = useState(saved);
  const form = useContractForm(schema, bodyFor(context));

  function reset() {
    setContext(saved);
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
      await onSave(context.trim());
      setEditing(false);
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setSaving(false);
    }
  }

  const prose = (text: string, muted = false) =>
    text ? <p class={muted ? "pk-prose-block pk-muted" : "pk-prose-block"}>{text}</p> : "None";

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
            <Field {...form.of("context")} label={term} help={help}>
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
                ...(below ? [{ term: below.term, value: prose(below.context, true) }] : []),
                { term, value: prose(saved) },
              ]}
            />
          )}
          <ErrorAlert error={error} />
        </PanelBody>
      </Panel>
    </form>
  );
}
