import { useState } from "preact/hooks";
import { UserPicker, type PickedUser } from "../../../../../components/UserPicker";
import { postJson } from "../../../../../shared/api-client";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { TextInput } from "../../../../../ui/TextControl";
import { toast } from "../../../ui";
import { userRoleResponseEnvelopeSchema } from "../../../../../../shared/schemas/access-control";
import { TargetPicker, type PickedTarget } from "../TargetPicker";

/**
 * Assigns the fixed role of an open RoleDetail — the same endpoint/schema
 * UserRoles.tsx assigns through, and now the same markup.
 *
 * The two refusals used to leave in a toast, which has usually faded by the
 * time the reader reaches the control it was about; they stay beside the form
 * as an `Alert`, whose danger tone carries role="alert" so it is announced
 * where it appears without moving focus. The three headings above the pickers
 * were `<label>` elements with no `for` at all — a label pointing at nothing
 * names nothing — so each group is now named by a legend or by its own Field.
 */
export function RoleAssignForm({ roleId, onAssigned }: { roleId: string; onAssigned: () => void }) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [target, setTarget] = useState<PickedTarget>({ targetType: null, targetId: null });
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleAssign(e: Event) {
    e.preventDefault();
    setFormError(null);
    if (!user) {
      setFormError("Pick a user first.");
      return;
    }
    if (target.targetType && !target.targetId) {
      setFormError("Pick a specific event or working group, or clear the context.");
      return;
    }
    setSubmitting(true);
    try {
      await postJson(
        `/api/v1/users/${user.id}/roles`,
        {
          roleId,
          contextType: target.targetType,
          contextId: target.targetId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        },
        userRoleResponseEnvelopeSchema,
      );
      toast("Role assigned", "success");
      setUser(null);
      setTarget({ targetType: null, targetId: null });
      setExpiresAt("");
      onAssigned();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form class="pk pk-stack" aria-label="Assign this role" onSubmit={(e) => void handleAssign(e)}>
      {/* One `disabled` takes the whole form out of play while the request is
          in flight, including the pickers this surface cannot reach a prop
          into. */}
      <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={submitting}>
        {/* The people search is several controls, so it is named by a legend
            rather than by a label with no single control to point its `for` at. */}
        <fieldset class="pk-fieldset pk-field">
          <legend class="pk-field__label">User</legend>
          <UserPicker endpoint="/api/v1/permissions/subjects" value={user} onChange={setUser} disabled={submitting} />
        </fieldset>
        <fieldset class="pk-fieldset pk-field">
          <legend class="pk-field__label">Target</legend>
          <TargetPicker value={target} onChange={setTarget} disabled={submitting} />
        </fieldset>
        <Field label="Expires (optional)" help="Leave empty for an assignment that never expires.">
          {(control) => (
            <TextInput
              {...control}
              type="datetime-local"
              value={expiresAt}
              onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
              disabled={submitting}
            />
          )}
        </Field>
      </fieldset>

      {formError && <Alert tone="danger">{formError}</Alert>}

      <div class="pk-cluster">
        {/* Not disabled on an empty picker: a control that is inert and says
            nothing leaves the reader to guess which of the three groups above
            it is unhappy. Submitting states the reason instead. */}
        <Button type="submit" variant="primary" size="sm" loading={submitting}>
          {submitting ? "Assigning…" : "Assign"}
        </Button>
      </div>
    </form>
  );
}
