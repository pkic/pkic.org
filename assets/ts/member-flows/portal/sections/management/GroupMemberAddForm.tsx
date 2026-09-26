import { useContractForm } from "../../../../hooks/useContractForm";
import { useState } from "preact/hooks";
import { groupMemberAddBodySchema, groupMembershipMutationResponseSchema } from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { Button } from "../../../../ui/Button";
import { GroupSeatFields, useGroupSeatDraft } from "./GroupSeatFields";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { postJson } from "../../../../shared/api-client";
// The group's name is written here as `pk-field__label` on a `<legend>`
// rather than reached through the `Field` component, so this module pulls the
// stylesheet into its own chunk instead of relying on what the entry sheet
// happens to carry today.
import "../../../../ui/Field.css";
import { fromCalendarDateInput, toCalendarDateInput } from "../../ui";

/**
 * Adds a person through every eligible Member affiliation. The seat starts
 * today unless backdated; giving it an end date records a former seat
 * instead, which grants nothing and keeps the roster's history.
 *
 * That end used to sit behind a checkbox — "This person has already left;
 * record a former seat" — whose label ran longer than the field it hid
 * (#34). The date says both things on its own: blank is a seat that is open,
 * filled is a seat that closed, and the button says which one is about to be
 * recorded.
 */
export function GroupMemberAddForm({
  groupId,
  onAdded,
  onCancel,
}: {
  groupId: string;
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const { draft, onDraft } = useGroupSeatDraft({
    joinedOn: toCalendarDateInput(new Date().toISOString()),
    leftOn: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useContractForm(groupMemberAddBodySchema, {
    capacitySelection: { mode: "all_eligible", confirmed: true },
    joinedAt: fromCalendarDateInput(draft.joinedOn) ?? undefined,
    leftAt: fromCalendarDateInput(draft.leftOn) ?? undefined,
  });

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    // `loading` keeps the submit button focusable rather than disabling it, so
    // the guard against a second submission lives here instead of in the
    // markup: a disabled control loses focus mid-form.
    if (saving || !user) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    setSaving(true);
    setError(null);
    try {
      await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/memberships/${encodeURIComponent(user.id)}`,
        checked.data,
        groupMembershipMutationResponseSchema,
      );
      setUser(null);
      await onAdded();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="pk pk-stack">
      <Panel aria-label="Add a person">
        <PanelHeader title="Add a person" headingLevel={2} breadcrumb />
        <PanelBody>
          <form
            noValidate
            {...form.handlers}
            onInput={(event) => {
              form.handlers.onInput(event);
              setError(null);
            }}
            class="pk-stack pk-stack--snug"
            onSubmit={(event) => void submit(event)}
          >
            <p class="pk-muted pk-small">
              The person joins through every currently eligible Member affiliation. Existing seats are unchanged.
            </p>
            <p class="pk-muted pk-small">
              Assign roles and titles in <a href={`#/groups/${groupId}/leadership`}>Leadership</a>.
            </p>
            {error && <ErrorAlert error={error} />}
            {/*
             * `UserPicker` names its own search box, so the heading beside it
             * used to be a `<label>` pointing at nothing. A `<legend>` names the
             * group the control belongs to, which is a relationship the markup
             * can express — and the `<fieldset>` is also the one attribute that
             * takes the picker out of play while the add is in flight.
             */}
            <fieldset class="pk-fieldset pk-field" disabled={saving}>
              <legend class="pk-field__label">Person</legend>
              <UserPicker
                value={user}
                onChange={setUser}
                disabled={saving}
                endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/users`}
              />
            </fieldset>
            <GroupSeatFields draft={draft} onDraft={onDraft} field={form.of} disabled={saving} />
            <div class="pk-cluster">
              {/* The end date decides what this button offers to do: a seat
                  with an end is a record of one that closed, not a grant. */}
              <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!user || !draft.joinedOn}>
                {saving
                  ? draft.leftOn
                    ? "Recording…"
                    : "Adding…"
                  : draft.leftOn
                    ? "Record former seat"
                    : "Add to group"}
              </Button>
              <Button size="sm" disabled={saving} onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </PanelBody>
      </Panel>
    </div>
  );
}
