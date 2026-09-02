import { useState } from "preact/hooks";
import { postJson } from "../../../../../shared/api-client";
import { useContractForm } from "../../../../../hooks/useContractForm";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { TextInput } from "../../../../../ui/TextControl";
import { toast } from "../../../ui";
import { roleCreateSchema, roleResponseEnvelopeSchema } from "../../../../../../shared/schemas/access-control";
import type { Permission } from "../../../../../../shared/schemas/permissions";
import { PermissionCheckboxes } from "./RolePermissions";

/** What the create contract accepts as an identifier, said before the reader finds out the hard way. */
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
  // One basis for validation: the create contract the server parses decides
  // what the name field shows as it is typed and what may be sent.
  const form = useContractForm(roleCreateSchema, {
    name,
    description: description || undefined,
    permissions: Array.from(selected),
  });

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
    // Nothing is sent until the contract accepts the whole draft.
    const checked = form.submit();
    if (!checked.data) {
      setFormError(checked.message);
      return;
    }
    setSubmitting(true);
    try {
      const created = await postJson("/api/v1/roles", checked.data, roleResponseEnvelopeSchema);
      toast("Role created", "success");
      onCreated(created.role.id);
    } catch (err) {
      // A server refusal names its fields the same way the contract does.
      setFormError(form.refuse(err));
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
          <form
            noValidate
            class="pk-stack"
            aria-label="New role"
            {...form.handlers}
            onSubmit={(e) => void handleCreate(e)}
          >
            {/* One `disabled` takes the whole form out of play while the
                request is in flight, including the permission checkboxes this
                surface renders through a child component. */}
            <fieldset class="pk-fieldset pk-stack" disabled={submitting}>
              <div class="pk-grid pk-grid--roomy">
                <Field label="Name" required help={ROLE_NAME_HELP} {...form.of("name")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="name"
                      value={name}
                      onInput={(e) => setName((e.target as HTMLInputElement).value)}
                      placeholder="e.g. sponsorship_lead"
                    />
                  )}
                </Field>
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
              {/* Several controls, so the group is named by a legend rather
                  than by a label with no single control to point its `for` at. */}
              <fieldset class="pk-fieldset pk-field">
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
