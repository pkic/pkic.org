import { useState } from "preact/hooks";
import { patchJson } from "../../../../shared/api-client";
import {
  userRoleValueSchema,
  userUpdateResponseSchema,
  userUpdateSchema,
} from "../../../../../shared/schemas/user-management";
import { FormActions } from "../../../../components/FormActions";
import { useContractForm } from "../../../../hooks/useContractForm";
import { Button } from "../../../../ui/Button";
import { Checkbox, Radio } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";
import { toast } from "../../ui";
import type { UserDetail } from "./model";

type EditableUser = {
  email: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  role: string;
  active: boolean;
  isEcMember: boolean;
};

type NameField = "firstName" | "lastName" | "preferredName";

const NAME_FIELDS: Array<[string, NameField]> = [
  ["First name", "firstName"],
  ["Last name", "lastName"],
  ["Preferred name", "preferredName"],
];

function editFormFor(user: UserDetail): EditableUser {
  return {
    email: user.email,
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    preferredName: user.preferred_name ?? "",
    role: user.role,
    active: user.active,
    isEcMember: user.isEcMember ?? false,
  };
}

/**
 * The update the form would send, built from its draft. A cleared name is
 * sent as null so the contract clears it; a blank address is left out so the
 * current one is kept, which is what the field's help promises. Only a reader
 * with access:grant may move the address or the role, so only then are they
 * part of the request at all.
 */
function payloadFromDraft(draft: EditableUser, canGrantAccess: boolean) {
  return {
    ...(canGrantAccess ? { email: draft.email.trim() ? draft.email : undefined, role: draft.role } : {}),
    firstName: draft.firstName || null,
    lastName: draft.lastName || null,
    preferredName: draft.preferredName || null,
    active: draft.active,
    isEcMember: draft.isEcMember,
  };
}

export function UserProfileEditor({
  user,
  canGrantAccess,
  onSaved,
}: {
  user: UserDetail;
  canGrantAccess: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<EditableUser>(() => editFormFor(user));
  // One basis for validation: the update contract the server parses decides
  // what each field shows as it is typed and what Save may send.
  const form = useContractForm(userUpdateSchema, payloadFromDraft(draft, canGrantAccess));

  function update(patch: Partial<EditableUser>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function startEditing() {
    setDraft(editFormFor(user));
    form.reset();
    setError("");
    setEditing(true);
  }

  async function save() {
    // Nothing leaves the page until the contract accepts the whole draft.
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await patchJson(`/api/v1/users/${encodeURIComponent(user.id)}`, checked.data, userUpdateResponseSchema);
      toast("User updated", "success");
      setEditing(false);
      await onSaved();
    } catch (cause) {
      // A server refusal names its fields the same way the contract does.
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div class="pk pk-cluster">
        <Button size="sm" onClick={startEditing}>
          Edit profile
        </Button>
      </div>
    );
  }

  return (
    <div class="pk">
      <form
        noValidate
        class="pk-stack pk-stack--snug"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {/* One `disabled` fieldset takes the whole form out of play while the
            save is in flight, in place of the same prop on every control. */}
        <fieldset class="pk-fieldset pk-stack pk-stack--snug" disabled={saving}>
          <div class="pk-grid pk-grid--tight">
            {NAME_FIELDS.map(([label, field]) => (
              <Field label={label} key={field} {...form.of(field)}>
                {(control) => (
                  <TextInput
                    {...control}
                    name={field}
                    value={draft[field]}
                    onInput={(event) => update({ [field]: event.currentTarget.value })}
                  />
                )}
              </Field>
            ))}
            {canGrantAccess && (
              <Field
                label="Email"
                help="Used to sign in. Leave unchanged to keep the current address."
                {...form.of("email")}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    name="email"
                    type="email"
                    value={draft.email}
                    onInput={(event) => update({ email: event.currentTarget.value })}
                  />
                )}
              </Field>
            )}
          </div>

          {canGrantAccess && (
            <fieldset class="pk-fieldset pk-field">
              <legend class="pk-field__label">Role</legend>
              <div class="pk-cluster">
                {userRoleValueSchema.options.map((role) => (
                  <Radio
                    key={role}
                    name="role"
                    value={role}
                    checked={draft.role === role}
                    onChange={() => update({ role })}
                    label={role}
                  />
                ))}
              </div>
            </fieldset>
          )}

          <fieldset class="pk-fieldset pk-field">
            <legend class="pk-field__label">Standing</legend>
            <div class="pk-stack pk-stack--tight">
              <Checkbox
                name="active"
                checked={draft.active}
                onChange={(event) => update({ active: event.currentTarget.checked })}
                label="Active"
              />
              <Checkbox
                name="isEcMember"
                checked={draft.isEcMember}
                onChange={(event) => update({ isEcMember: event.currentTarget.checked })}
                label="Executive Council member"
              />
            </div>
          </fieldset>
        </fieldset>

        {/* The save/cancel pair, its busy state, and a failed save announced as
            an alert rather than as red text, all from the shared component. */}
        <FormActions
          submitLabel="Save"
          busyLabel="Saving…"
          busy={saving}
          onCancel={() => setEditing(false)}
          status={error || undefined}
          statusVariant="danger"
        />
      </form>
    </div>
  );
}
