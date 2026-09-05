import { UserPicker } from "../../../../../components/UserPicker";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { TextInput } from "../../../../../ui/TextControl";
import { toast } from "../../../ui";
import { TargetPicker } from "../TargetPicker";
import { useRoleAssignment } from "../use-role-assignment";

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
  const { form, submitting, formError, user, setUser, target, setTarget, expiresAt, setExpiresAt, handleAssign } =
    useRoleAssignment({
      roleId,
      onAssigned: () => {
        toast("Role assigned", "success");
        setUser(null);
        onAssigned();
      },
    });

  return (
    <form
      noValidate
      class="pk pk-stack"
      aria-label="Assign this role"
      {...form.handlers}
      onSubmit={(e) => void handleAssign(e)}
    >
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
        <Field
          label="Expires (optional)"
          help="Leave empty for an assignment that never expires."
          {...form.of("expiresAt")}
        >
          {(control) => (
            <TextInput
              {...control}
              type="datetime-local"
              name="expiresAt"
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
