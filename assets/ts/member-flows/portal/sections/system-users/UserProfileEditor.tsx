import { useState } from "preact/hooks";
import { patchJson } from "../../../../shared/api-client";
import {
  userRoleValueSchema,
  userUpdateResponseSchema,
  userUpdateSchema,
} from "../../../../../shared/schemas/user-management";
import { FormActions } from "../../../../components/FormActions";
import { Button } from "../../../../ui/Button";
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

const NAME_FIELDS: Array<[string, keyof EditableUser]> = [
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
 * The address is checked against the canonical update contract rather than a
 * second regular expression written here: a rejection the server would issue
 * anyway is better said beside the control that caused it, and there is only
 * one definition of what a valid address is.
 */
function emailProblem(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  return userUpdateSchema.safeParse({ email: trimmed }).success ? null : "Enter a valid email address.";
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
  const [form, setForm] = useState<EditableUser>(() => editFormFor(user));

  const emailError = canGrantAccess ? emailProblem(form.email) : null;

  function update(patch: Partial<EditableUser>): void {
    setForm((current) => ({ ...current, ...patch }));
  }

  function startEditing() {
    setForm(editFormFor(user));
    setError("");
    setEditing(true);
  }

  async function save() {
    if (emailError) return;
    setSaving(true);
    setError("");
    try {
      await patchJson(
        `/api/v1/users/${encodeURIComponent(user.id)}`,
        {
          ...(canGrantAccess ? { email: form.email.trim().toLowerCase() || undefined, role: form.role } : {}),
          firstName: form.firstName || null,
          lastName: form.lastName || null,
          preferredName: form.preferredName || null,
          active: form.active,
          isEcMember: form.isEcMember,
        },
        userUpdateResponseSchema,
      );
      toast("User updated", "success");
      setEditing(false);
      await onSaved();
    } catch (cause) {
      setError((cause as Error).message);
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
        class="pk-stack pk-stack--snug"
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
              <Field label={label} key={field}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={form[field] as string}
                    onInput={(event) => update({ [field]: event.currentTarget.value })}
                  />
                )}
              </Field>
            ))}
            {canGrantAccess && (
              <Field
                label="Email"
                state={emailError ? "invalid" : undefined}
                message={emailError ?? undefined}
                help="Used to sign in. Leave unchanged to keep the current address."
              >
                {(control) => (
                  <TextInput
                    {...control}
                    type="email"
                    value={form.email}
                    onInput={(event) => update({ email: event.currentTarget.value })}
                  />
                )}
              </Field>
            )}
          </div>

          {canGrantAccess && (
            <fieldset class="pk-fieldset pk-stack pk-stack--tight">
              <legend class="pk-field__label">Role</legend>
              <div class="pk-cluster">
                {userRoleValueSchema.options.map((role) => (
                  <label class="pk-check" for={`edit-role-${role}`} key={role}>
                    <input
                      class="pk-check__input"
                      type="radio"
                      id={`edit-role-${role}`}
                      name="edit-role"
                      checked={form.role === role}
                      onChange={() => update({ role })}
                    />
                    <span class="pk-check__label">{role}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset class="pk-fieldset pk-stack pk-stack--tight">
            <legend class="pk-field__label">Standing</legend>
            <label class="pk-check" for="edit-active">
              <input
                class="pk-check__input"
                type="checkbox"
                id="edit-active"
                checked={form.active}
                onChange={(event) => update({ active: event.currentTarget.checked })}
              />
              <span class="pk-check__label">Active</span>
            </label>
            <label class="pk-check" for="edit-ec-member">
              <input
                class="pk-check__input"
                type="checkbox"
                id="edit-ec-member"
                checked={form.isEcMember}
                onChange={(event) => update({ isEcMember: event.currentTarget.checked })}
              />
              <span class="pk-check__label">Executive Council member</span>
            </label>
          </fieldset>
        </fieldset>

        {/* The save/cancel pair, its busy state, and a failed save announced as
            an alert rather than as red text, all from the shared component. */}
        <FormActions
          submitLabel="Save"
          busyLabel="Saving…"
          busy={saving}
          disabled={Boolean(emailError)}
          onCancel={() => setEditing(false)}
          status={error || undefined}
          statusVariant="danger"
        />
      </form>
    </div>
  );
}
