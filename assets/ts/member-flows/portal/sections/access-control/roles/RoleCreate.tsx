import { useState } from "preact/hooks";
import { postValidated } from "../../../../../shared/api-client";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { TextInput } from "../../../../../ui/TextControl";
import { toast } from "../../../ui";
import { roleCreateSchema, roleResponseEnvelopeSchema } from "../../../../../../shared/schemas/access-control";
import type { Permission } from "../../../../../../shared/schemas/permissions";
import { PermissionCheckboxes } from "./RolePermissions";

/** The identifier shape the create contract accepts, so the field can say so before the server does. */
const ROLE_NAME_PATTERN = "^[a-z][a-z0-9_]*$";
const ROLE_NAME_RULE = /^[a-z][a-z0-9_]*$/;
const ROLE_NAME_HELP = "Lowercase letters, numbers, and underscores only, starting with a letter.";

/** Distinct create-role view: replaces the roles list rather than layering above it. */
export function RoleCreate({ onCreated, onCancel }: { onCreated: (roleId: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<Permission>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  /*
   * What went wrong stays beside the form rather than in a toast that has
   * already faded by the time the reader reaches the control it is about.
   * `Alert`'s danger tone carries role="alert", so it is announced as it
   * appears without moving focus out of the form.
   */
  const [formError, setFormError] = useState<string | null>(null);

  const trimmedName = name.trim();
  // An empty field is not yet wrong — it is unfinished — so the invalid state
  // waits until there is something to judge. `required` already covers empty.
  const nameInvalid = trimmedName !== "" && !ROLE_NAME_RULE.test(trimmedName);

  function toggle(permission: Permission) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  async function handleCreate(e: Event) {
    e.preventDefault();
    setFormError(null);
    if (!trimmedName) {
      setFormError("Give the role a name.");
      return;
    }
    if (nameInvalid) {
      setFormError(ROLE_NAME_HELP);
      return;
    }
    setSubmitting(true);
    try {
      const created = await postValidated(
        "/api/v1/roles",
        roleCreateSchema,
        {
          name: trimmedName,
          description: description.trim() || undefined,
          permissions: Array.from(selected),
        },
        roleResponseEnvelopeSchema,
      );
      toast("Role created", "success");
      onCreated(created.role.id);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="pk pk-stack">
      <div class="pk-cluster">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          ← All roles
        </Button>
      </div>
      <Panel>
        <PanelHeader title="New role" />
        <PanelBody>
          {/* The form is named, so the panel it sits in and the form itself are
              distinguishable to anything navigating by landmark or by form. */}
          <form class="pk-stack" aria-label="New role" onSubmit={(e) => void handleCreate(e)}>
            {/* One `disabled` takes the whole form out of play while the
                request is in flight, including the permission checkboxes this
                surface renders through a child component. */}
            <fieldset class="pk-fieldset pk-stack" disabled={submitting}>
              <div class="pk-grid pk-grid--roomy">
                <Field
                  label="Name"
                  required
                  help={ROLE_NAME_HELP}
                  state={nameInvalid ? "invalid" : undefined}
                  message={nameInvalid ? ROLE_NAME_HELP : undefined}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      value={name}
                      onInput={(e) => setName((e.target as HTMLInputElement).value)}
                      placeholder="e.g. sponsorship_lead"
                      pattern={ROLE_NAME_PATTERN}
                    />
                  )}
                </Field>
                <Field label="Description">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={description}
                      onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
              </div>
              {/* Several controls, so the group is named by a legend rather
                  than by a label with no single control to point its `for` at. */}
              <fieldset class="pk-fieldset pk-stack pk-stack--tight">
                <legend class="pk-field__label">Permissions</legend>
                <PermissionCheckboxes selected={selected} onToggle={toggle} disabled={submitting} />
              </fieldset>
            </fieldset>

            {formError && <Alert tone="danger">{formError}</Alert>}

            <div class="pk-cluster">
              <Button type="submit" variant="primary" size="sm" loading={submitting}>
                {submitting ? "Creating…" : "Create role"}
              </Button>
              <Button variant="secondary" size="sm" disabled={submitting} onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </PanelBody>
      </Panel>
    </div>
  );
}
