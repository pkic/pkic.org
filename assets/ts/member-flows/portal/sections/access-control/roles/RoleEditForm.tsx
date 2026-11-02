import { useState } from "preact/hooks";
import { FormActions } from "../../../../../components/FormActions";
import { useContractForm } from "../../../../../hooks/useContractForm";
import { patchJson } from "../../../../../shared/api-client";
import { Field } from "../../../../../ui/Field";
import { TextInput } from "../../../../../ui/TextControl";
import { toast } from "../../../ui";
import {
  roleResponseEnvelopeSchema,
  roleUpdateSchema,
  type Role,
} from "../../../../../../shared/schemas/access-control";
import type { Permission } from "../../../../../../shared/schemas/permissions";
import { RolePermissions } from "./RolePermissions";

/** Edits a role's name/description/permission bundle behind an explicit Edit action on RoleDetail. */
export function RoleEditForm({
  role,
  onSaved,
  onCancel,
}: {
  role: Role;
  onSaved: (role: Role) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [selected, setSelected] = useState<Set<Permission>>(new Set(role.permissions));
  const [submitting, setSubmitting] = useState(false);
  // A refused save used to be a toast and nothing else, so it was gone before
  // the reader had finished reading it and left no trace beside the form that
  // still held the rejected values.
  const [error, setError] = useState<string | null>(null);

  const form = useContractForm(roleUpdateSchema, {
    ...(role.isSystemRole ? {} : { name: name.trim() }),
    description: description.trim() || null,
    permissions: Array.from(selected),
    revision: role.updatedAt,
  });

  async function handleSave(e: Event) {
    e.preventDefault();
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage);
    setSubmitting(true);
    setError(null);
    try {
      const updated = await patchJson(`/api/v1/roles/${role.id}`, checked.data, roleResponseEnvelopeSchema);
      toast("Role updated", "success");
      onSaved(updated.role);
    } catch (err) {
      setError(form.refuse(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate class="pk pk-stack" {...form.handlers} onSubmit={handleSave}>
      {/* One `disabled` attribute takes the whole form out of play while the
          save is in flight, including the checkboxes a child component
          renders and which no prop from here could otherwise reach. */}
      <fieldset class="pk-fieldset pk-stack" disabled={submitting}>
        <div class="pk-grid pk-grid--roomy">
          {!role.isSystemRole && (
            <Field
              label="Name"
              required
              {...form.of("name")}
              help="Lower case, digits and underscores; must start with a letter."
            >
              {(control) => (
                <TextInput
                  {...control}
                  value={name}
                  onInput={(e) => setName((e.target as HTMLInputElement).value)}
                  name="name"
                />
              )}
            </Field>
          )}
          <Field label="Description" {...form.of("description")}>
            {(control) => (
              <TextInput
                {...control}
                name="description"
                value={description}
                onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
              />
            )}
          </Field>
        </div>
        {/* "Permissions" used to be a bare `<label>` with no `for`, so it
            named nothing: the checkboxes below it were an unlabelled run of
            controls. A `<legend>` names the group it actually introduces. */}
        <fieldset class="pk-fieldset pk-field">
          <legend class="pk-field__label">Permissions</legend>
          <RolePermissions selected={selected} onSelect={setSelected} disabled={submitting} />
        </fieldset>
      </fieldset>
      <FormActions
        submitLabel="Save changes"
        busyLabel="Saving…"
        busy={submitting}
        onCancel={onCancel}
        status={error ?? undefined}
        statusVariant="danger"
        disabled={!form.valid}
      />
    </form>
  );
}
