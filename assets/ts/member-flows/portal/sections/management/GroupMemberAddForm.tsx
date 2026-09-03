import { useState } from "preact/hooks";
import { groupMemberAddBodySchema, groupMembershipMutationResponseSchema } from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { GroupSeatFields } from "./GroupSeatFields";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { ApiClientError, postValidated } from "../../../../shared/api-client";
// The group's name is written here as `pk-field__label` on a `<legend>`
// rather than reached through the `Field` component, so this module pulls the
// stylesheet into its own chunk instead of relying on what the entry sheet
// happens to carry today.
import "../../../../ui/Field.css";
import { fromCalendarDateInput, toCalendarDateInput } from "../../ui";

/**
 * Adds a person through every eligible Member affiliation. The seat starts
 * today unless backdated; marking the person as already gone records a
 * former seat instead, which grants nothing and keeps the roster's history.
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
  const [title, setTitle] = useState("");
  const [joinedOn, setJoinedOn] = useState(toCalendarDateInput(new Date().toISOString()));
  const [former, setFormer] = useState(false);
  const [leftOn, setLeftOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    // `loading` keeps the submit button focusable rather than disabling it, so
    // the guard against a second submission lives here instead of in the
    // markup: a disabled control loses focus mid-form.
    if (saving || !user) return;
    setSaving(true);
    setError(null);
    try {
      await postValidated(
        `/api/v1/groups/${encodeURIComponent(groupId)}/memberships/${encodeURIComponent(user.id)}`,
        groupMemberAddBodySchema,
        {
          capacitySelection: { mode: "all_eligible", confirmed: true },
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(joinedOn ? { joinedAt: fromCalendarDateInput(joinedOn) ?? undefined } : {}),
          ...(former && leftOn ? { leftAt: fromCalendarDateInput(leftOn) } : {}),
        },
        groupMembershipMutationResponseSchema,
      );
      setUser(null);
      await onAdded();
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
            The person joins through every currently eligible Member affiliation. Existing seats are unchanged.
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
          <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={saving}>
            <GroupSeatFields
              draft={{ title, joinedOn, leftOn }}
              onDraft={(patch) => {
                if (patch.title !== undefined) setTitle(patch.title);
                if (patch.joinedOn !== undefined) setJoinedOn(patch.joinedOn);
                if (patch.leftOn !== undefined) setLeftOn(patch.leftOn);
              }}
              showEnd={former}
              endRequired
            />
            <Checkbox
              checked={former}
              onChange={(event) => setFormer(event.currentTarget.checked)}
              label="This person has already left; record a former seat"
            />
          </fieldset>
          <div class="pk-cluster">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              loading={saving}
              disabled={!user || !joinedOn || (former && !leftOn)}
            >
              {saving ? (former ? "Recording…" : "Adding…") : former ? "Record former seat" : "Add to group"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
