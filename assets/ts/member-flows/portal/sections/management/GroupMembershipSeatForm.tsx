import { useState } from "preact/hooks";
import {
  groupMembershipMutationResponseSchema,
  groupMembershipUpdateSchema,
  type GroupMembership,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { GroupSeatFields } from "./GroupSeatFields";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { ApiClientError, patchJson } from "../../../../shared/api-client";
import { fromCalendarDateInput, toCalendarDateInput } from "../../ui";
import { capacityLabel } from "./group-leadership";

/** Edits one seat's title and service dates; clearing the end date reopens a former seat. */
export function GroupMembershipSeatForm({
  groupId,
  membership,
  onSaved,
  onCancel,
}: {
  groupId: string;
  membership: GroupMembership;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(membership.title ?? "");
  const [joinedOn, setJoinedOn] = useState(toCalendarDateInput(membership.joinedAt));
  const [leftOn, setLeftOn] = useState(toCalendarDateInput(membership.leftAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const patch = groupMembershipUpdateSchema.parse({
        title: title.trim() || null,
        joinedAt: fromCalendarDateInput(joinedOn) ?? undefined,
        leftAt: fromCalendarDateInput(leftOn),
      });
      await patchJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/memberships/${encodeURIComponent(membership.id)}`,
        patch,
        groupMembershipMutationResponseSchema,
      );
      await onSaved();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not update this seat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    // Nested inside the tab's panel, so its heading is one rung below that
    // panel's rather than another <h3> beside it.
    <Panel class="pk" aria-label={`Edit seat for ${membership.userName} (${capacityLabel(membership)})`}>
      <PanelHeader title={`Edit seat for ${membership.userName} (${capacityLabel(membership)})`} headingLevel={4}>
        <Button size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </PanelHeader>
      <PanelBody>
        <form class="pk-stack pk-stack--snug" onSubmit={(event) => void submit(event)}>
          <p class="pk-muted pk-small">
            An end date closes the seat and any leadership held through it; clearing it reopens the seat if the person's
            Member capacity is still active.
          </p>
          {error && <ErrorAlert error={error} />}
          <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={saving}>
            <GroupSeatFields
              draft={{ title, joinedOn, leftOn }}
              onDraft={(patch) => {
                if (patch.title !== undefined) setTitle(patch.title);
                if (patch.joinedOn !== undefined) setJoinedOn(patch.joinedOn);
                if (patch.leftOn !== undefined) setLeftOn(patch.leftOn);
              }}
            />
          </fieldset>
          <div class="pk-cluster">
            <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!joinedOn}>
              {saving ? "Saving…" : "Save seat"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
