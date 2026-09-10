import { useContractForm } from "../../../../hooks/useContractForm";
import { useState } from "preact/hooks";
import {
  groupMembershipMutationResponseSchema,
  groupMembershipUpdateSchema,
  type GroupMembership,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { GroupSeatFields, useGroupSeatDraft } from "./GroupSeatFields";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { patchJson } from "../../../../shared/api-client";
import { fromCalendarDateInput, toCalendarDateInput } from "../../ui";
import { capacityLabel } from "./group-leadership";

/** Edits service dates; clearing the end date reopens a former seat. */
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
  const { draft, onDraft } = useGroupSeatDraft({
    joinedOn: toCalendarDateInput(membership.joinedAt),
    leftOn: toCalendarDateInput(membership.leftAt),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useContractForm(groupMembershipUpdateSchema, {
    joinedAt: fromCalendarDateInput(draft.joinedOn) ?? undefined,
    leftAt: fromCalendarDateInput(draft.leftOn),
  });

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    setSaving(true);
    setError(null);
    try {
      await patchJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/memberships/${encodeURIComponent(membership.id)}`,
        checked.data,
        groupMembershipMutationResponseSchema,
      );
      await onSaved();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    // Nested inside the tab's panel, so its heading is one rung below that
    // panel's rather than another <h3> beside it.
    <div class="pk pk-stack">
      <Panel aria-label={`Edit seat for ${membership.userName} (${capacityLabel(membership)})`}>
        <PanelHeader
          title={`Edit seat for ${membership.userName} (${capacityLabel(membership)})`}
          headingLevel={2}
          breadcrumb
        >
          <Button size="sm" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        </PanelHeader>
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
              An end date closes the seat and any leadership held through it; clearing it reopens the seat if the
              person's Member capacity is still active.
            </p>
            <p class="pk-muted pk-small">
              Manage roles and titles in <a href={`#/groups/${groupId}/leadership`}>Leadership</a>.
            </p>
            {error && <ErrorAlert error={error} />}
            <GroupSeatFields draft={draft} onDraft={onDraft} field={form.of} disabled={saving} />
            <div class="pk-cluster">
              <Button type="submit" size="sm" variant="primary" loading={saving} disabled={!draft.joinedOn}>
                {saving ? "Saving…" : "Save seat"}
              </Button>
            </div>
          </form>
        </PanelBody>
      </Panel>
    </div>
  );
}
