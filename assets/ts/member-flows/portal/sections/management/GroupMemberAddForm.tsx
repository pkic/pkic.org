import { useState } from "preact/hooks";
import { groupMemberAddBodySchema, groupMembershipMutationResponseSchema } from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { FormActions } from "../../../../components/FormActions";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { ApiClientError, postValidated } from "../../../../shared/api-client";
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
    if (!user) return;
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
    <form class="border rounded p-3 d-flex flex-column gap-3 bg-light" onSubmit={submit}>
      <div>
        <h6 class="mb-1">Add a person</h6>
        <p class="text-muted small mb-0">
          The person joins through every currently eligible Member affiliation. Existing seats are unchanged.
        </p>
      </div>
      {error && <ErrorAlert error={error} />}
      <div class="row g-3">
        <div class="col-lg-6">
          <label class="form-label small fw-semibold" for="managed-group-member-user">
            Person
          </label>
          <div id="managed-group-member-user">
            <UserPicker
              value={user}
              onChange={setUser}
              disabled={saving}
              endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/users`}
            />
          </div>
        </div>
        <div class="col-lg-3">
          <label class="form-label small fw-semibold" for="managed-group-member-title">
            Seat title <span class="text-muted fw-normal">(optional)</span>
          </label>
          <input
            id="managed-group-member-title"
            class="form-control"
            maxLength={80}
            placeholder="Member"
            value={title}
            disabled={saving}
            onInput={(event) => setTitle((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-lg-3">
          <label class="form-label small fw-semibold" for="managed-group-member-joined">
            Member since
          </label>
          <input
            id="managed-group-member-joined"
            class="form-control"
            type="date"
            required
            value={joinedOn}
            disabled={saving}
            onInput={(event) => setJoinedOn((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-lg-6">
          <label class="form-check">
            <input
              class="form-check-input"
              type="checkbox"
              checked={former}
              disabled={saving}
              onChange={(event) => setFormer((event.target as HTMLInputElement).checked)}
            />
            <span class="form-check-label">This person has already left; record a former seat</span>
          </label>
        </div>
        {former && (
          <div class="col-lg-3">
            <label class="form-label small fw-semibold" for="managed-group-member-left">
              Member until
            </label>
            <input
              id="managed-group-member-left"
              class="form-control"
              type="date"
              required
              value={leftOn}
              min={joinedOn || undefined}
              disabled={saving}
              onInput={(event) => setLeftOn((event.target as HTMLInputElement).value)}
            />
          </div>
        )}
      </div>
      <FormActions
        submitLabel={former ? "Record former seat" : "Add to group"}
        busyLabel={former ? "Recording…" : "Adding…"}
        busy={saving}
        disabled={!user || !joinedOn || (former && !leftOn)}
        onCancel={onCancel}
      />
    </form>
  );
}
