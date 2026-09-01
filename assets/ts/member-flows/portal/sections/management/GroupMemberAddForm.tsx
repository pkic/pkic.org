import { useState } from "preact/hooks";
import { groupMemberAddSchema, groupMembershipMutationResponseSchema } from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { ApiClientError, postValidated } from "../../../../shared/api-client";
// The group's name is written here as `pk-field__label` on a `<legend>`
// rather than reached through the `Field` component, so this module pulls the
// stylesheet into its own chunk instead of relying on what the entry sheet
// happens to carry today.
import "../../../../ui/Field.css";

export function GroupMemberAddForm({
  groupId,
  onAdded,
  onCancel,
}: {
  groupId: string;
  onAdded: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    // `loading` keeps the submit button focusable rather than disabling it, so
    // the guard against a second submission lives here instead of in the
    // markup: a disabled control loses focus mid-form.
    if (saving || !user) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const input = groupMemberAddSchema.parse({
        userId: user.id,
        capacitySelection: { mode: "all_eligible", confirmed: true },
      });
      await postValidated(
        `/api/v1/groups/${encodeURIComponent(groupId)}/memberships/${encodeURIComponent(input.userId)}`,
        groupMemberAddSchema.omit({ userId: true }),
        { capacitySelection: input.capacitySelection },
        groupMembershipMutationResponseSchema,
      );
      setUser(null);
      await onAdded();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not add this person to the group.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // Nested inside the membership panel, so its heading is one rung below
    // that panel's rather than another <h3> beside it.
    <Panel class="pk" aria-label="Add a person">
      <PanelHeader title="Add a person" headingLevel={4}>
        {onCancel && (
          <Button size="sm" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </PanelHeader>
      <PanelBody>
        <form class="pk-stack pk-stack--snug" onSubmit={(event) => void submit(event)}>
          <p class="pk-muted pk-small">
            The person joins through every currently eligible Member affiliation. Existing capacities remain unchanged.
          </p>
          {error && <ErrorAlert error={error} />}
          {saved && <Alert tone="ok">Group participation added.</Alert>}
          {/*
           * `UserPicker` names its own search box, so the heading beside it
           * used to be a `<label>` pointing at nothing. A `<legend>` names the
           * group the control belongs to, which is a relationship the markup
           * can express — and the `<fieldset>` is also the one attribute that
           * takes the picker out of play while the add is in flight.
           */}
          <fieldset class="pk-fieldset pk-field" disabled={saving}>
            <legend class="pk-field__label">User</legend>
            <UserPicker
              value={user}
              onChange={setUser}
              disabled={saving}
              endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/users`}
            />
          </fieldset>
          <div class="pk-cluster">
            <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!user}>
              {saving ? "Adding…" : "Add to group"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
