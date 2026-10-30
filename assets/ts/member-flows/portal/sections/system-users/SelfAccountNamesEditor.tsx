/**
 * The person's own names, edited in a dialog opened from the Account panel's menu.
 *
 * Names are facts about the account, not about any identity. They are written
 * through the member contract (`/api/v1/users/current`), not the staff update:
 * nobody administers themselves, whatever permissions they also hold. Job
 * title, biography and links belong to each identity and are edited from its
 * row under Affiliations.
 */
import { useRef, useState } from "preact/hooks";
import { myProfileSchema, myProfileUpdateSchema } from "../../../../../shared/schemas/me";
import { useContractForm } from "../../../../hooks/useContractForm";
import { patchJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Dialog } from "../../../../ui/Dialog";
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";
import { saveProfile } from "../../state";
import { toast } from "../../ui";
import { CURRENT_USER_API } from "./current-user-api";
import type { UserDetail } from "./model";

const namesUpdateSchema = myProfileUpdateSchema.pick({ firstName: true, lastName: true, preferredName: true });

const NAME_FIELDS = [
  ["First name", "firstName"],
  ["Last name", "lastName"],
  ["Preferred name", "preferredName"],
] as const;

export function SelfAccountNamesEditor({
  user,
  onClose,
  onSaved,
}: {
  user: UserDetail;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState({
    firstName: user.first_name ?? "",
    lastName: user.last_name ?? "",
    preferredName: user.preferred_name ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Checked by the contract the route parses, live and on submit.
  const form = useContractForm(namesUpdateSchema, {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    preferredName: draft.preferredName.trim(),
  });

  async function save(): Promise<void> {
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setSaving(true);
    setError("");
    try {
      saveProfile(await patchJson(CURRENT_USER_API, checked.data, myProfileSchema));
      toast("Names updated", "success");
      onClose();
      await onSaved();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  const root = useRef<HTMLDivElement>(null);

  return (
    <Dialog
      open
      title="Edit names"
      closeLabel="Close names editor"
      confirmLabel={saving ? "Saving…" : "Save"}
      confirmDisabled={saving}
      onConfirm={() => root.current?.querySelector("form")?.requestSubmit()}
      onCancel={() => {
        if (!saving) onClose();
      }}
    >
      <div ref={root}>
        <form
          noValidate
          class="pk-stack pk-stack--snug"
          {...form.handlers}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset class="pk-fieldset pk-stack pk-stack--snug" disabled={saving}>
            {NAME_FIELDS.map(([label, field]) => (
              <Field label={label} required={field !== "preferredName"} key={field} {...form.of(field)}>
                {(control) => (
                  <TextInput
                    {...control}
                    name={field}
                    value={draft[field]}
                    onInput={(event) => setDraft((current) => ({ ...current, [field]: event.currentTarget.value }))}
                    placeholder={field === "preferredName" ? "Shown instead of first and last name" : undefined}
                  />
                )}
              </Field>
            ))}
          </fieldset>
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </div>
    </Dialog>
  );
}
