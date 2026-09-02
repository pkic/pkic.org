import { useState } from "preact/hooks";
import {
  groupLeadershipListResponseSchema,
  groupLeadershipUpdateSchema,
  type GroupLeadershipAssignment,
  type GroupLeadershipRoleId,
  type GroupLeadershipTitles,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { FormActions } from "../../../../components/FormActions";
import { ApiClientError, patchJson } from "../../../../shared/api-client";
import { fromCalendarDateInput, toCalendarDateInput } from "../../ui";
import { groupLeadershipTitleOptions } from "./group-leadership";

/**
 * A title field that suggests the group type's default and the shared
 * vocabulary while accepting anything: the suggestions are a shortcut, the
 * text is the contract.
 */
export function GroupLeadershipTitleInput({
  id,
  titles,
  roleId,
  value,
  disabled,
  onChange,
}: {
  id: string;
  titles: GroupLeadershipTitles;
  roleId: GroupLeadershipRoleId;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const listId = `${id}-suggestions`;
  return (
    <div>
      <label class="form-label small fw-semibold" for={id}>
        Title
      </label>
      <input
        id={id}
        class="form-control"
        list={listId}
        maxLength={80}
        required
        value={value}
        disabled={disabled}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
      <datalist id={listId}>
        {groupLeadershipTitleOptions(titles, roleId).map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </div>
  );
}

/** Edits the title or term of one local assignment; clearing the end reopens a closed term. */
export function GroupLeadershipTermForm({
  groupId,
  assignment,
  titles,
  onSaved,
  onCancel,
}: {
  groupId: string;
  assignment: GroupLeadershipAssignment;
  titles: GroupLeadershipTitles;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(assignment.title);
  const [startsOn, setStartsOn] = useState(toCalendarDateInput(assignment.startsAt));
  const [endsOn, setEndsOn] = useState(toCalendarDateInput(assignment.endsAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const patch = groupLeadershipUpdateSchema.parse({
        title: title.trim(),
        startsAt: fromCalendarDateInput(startsOn) ?? undefined,
        endsAt: fromCalendarDateInput(endsOn),
      });
      await patchJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/leadership/${encodeURIComponent(assignment.userRoleId)}`,
        patch,
        groupLeadershipListResponseSchema,
      );
      await onSaved();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not update this leadership term.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="border rounded p-3 d-flex flex-column gap-3 bg-light" onSubmit={submit}>
      <div>
        <h6 class="mb-1">Edit term for {assignment.userName}</h6>
        <p class="text-muted small mb-0">
          An end date in the past closes the term; a future one schedules the hand-over; none keeps it open.
        </p>
      </div>
      {error && <ErrorAlert error={error} />}
      <div class="row g-3">
        <div class="col-lg-4">
          <GroupLeadershipTitleInput
            id="managed-group-leadership-edit-title"
            titles={titles}
            roleId={assignment.roleId}
            value={title}
            disabled={saving}
            onChange={setTitle}
          />
        </div>
        <div class="col-sm-6 col-lg-4">
          <label class="form-label small fw-semibold" for="managed-group-leadership-edit-starts">
            Term starts
          </label>
          <input
            id="managed-group-leadership-edit-starts"
            class="form-control"
            type="date"
            required
            value={startsOn}
            disabled={saving}
            onInput={(event) => setStartsOn((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-sm-6 col-lg-4">
          <label class="form-label small fw-semibold" for="managed-group-leadership-edit-ends">
            Term ends <span class="text-muted fw-normal">(optional)</span>
          </label>
          <input
            id="managed-group-leadership-edit-ends"
            class="form-control"
            type="date"
            value={endsOn}
            min={startsOn || undefined}
            disabled={saving}
            onInput={(event) => setEndsOn((event.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <FormActions
        submitLabel="Save term"
        busyLabel="Saving…"
        busy={saving}
        disabled={!title.trim() || !startsOn}
        onCancel={onCancel}
      />
    </form>
  );
}
