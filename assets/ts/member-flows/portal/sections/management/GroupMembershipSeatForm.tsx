import { useState } from "preact/hooks";
import {
  groupMembershipMutationResponseSchema,
  groupMembershipUpdateSchema,
  type GroupMembership,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { FormActions } from "../../../../components/FormActions";
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
    <form class="border rounded p-3 d-flex flex-column gap-3 bg-light" onSubmit={submit}>
      <div>
        <h6 class="mb-1">
          Edit seat for {membership.userName} <span class="text-muted fw-normal">({capacityLabel(membership)})</span>
        </h6>
        <p class="text-muted small mb-0">
          An end date closes the seat and any leadership held through it; clearing it reopens the seat if the person's
          Member capacity is still active.
        </p>
      </div>
      {error && <ErrorAlert error={error} />}
      <div class="row g-3">
        <div class="col-lg-4">
          <label class="form-label small fw-semibold" for="managed-group-seat-title">
            Seat title <span class="text-muted fw-normal">(optional)</span>
          </label>
          <input
            id="managed-group-seat-title"
            class="form-control"
            maxLength={80}
            placeholder="Member"
            value={title}
            disabled={saving}
            onInput={(event) => setTitle((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-sm-6 col-lg-4">
          <label class="form-label small fw-semibold" for="managed-group-seat-joined">
            Member since
          </label>
          <input
            id="managed-group-seat-joined"
            class="form-control"
            type="date"
            required
            value={joinedOn}
            disabled={saving}
            onInput={(event) => setJoinedOn((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-sm-6 col-lg-4">
          <label class="form-label small fw-semibold" for="managed-group-seat-left">
            Member until <span class="text-muted fw-normal">(optional)</span>
          </label>
          <input
            id="managed-group-seat-left"
            class="form-control"
            type="date"
            value={leftOn}
            min={joinedOn || undefined}
            disabled={saving}
            onInput={(event) => setLeftOn((event.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <FormActions submitLabel="Save seat" busyLabel="Saving…" busy={saving} disabled={!joinedOn} onCancel={onCancel} />
    </form>
  );
}
