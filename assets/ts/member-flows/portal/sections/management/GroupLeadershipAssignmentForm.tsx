import { useState } from "preact/hooks";
import {
  GROUP_LEADERSHIP_ROLE_IDS,
  groupLeadershipAssignSchema,
  groupLeadershipListResponseSchema,
  type GroupLeadershipAssignment,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { ApiClientError, postJson } from "../../../../shared/api-client";
import { GROUP_LEADERSHIP_ROLE_LABELS } from "./group-leadership";

export function GroupLeadershipAssignmentForm({
  groupId,
  onAssigned,
}: {
  groupId: string;
  onAssigned: () => Promise<void>;
}) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [roleId, setRoleId] = useState<GroupLeadershipAssignment["roleId"]>("role-group_lead");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const input = groupLeadershipAssignSchema.parse({
        userId: user.id,
        roleId,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/leadership`,
        input,
        groupLeadershipListResponseSchema,
      );
      setUser(null);
      setExpiresAt("");
      await onAssigned();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not add this leadership assignment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="border rounded p-3 d-flex flex-column gap-3" onSubmit={submit}>
      <div>
        <h6 class="mb-1">Add local leadership</h6>
        <p class="text-muted small mb-0">
          Local assignments extend inherited leadership. An optional expiry ends the assignment automatically.
        </p>
      </div>
      {error && <ErrorAlert error={error} />}
      {saved && <div class="alert alert-success mb-0">Leadership assignment added.</div>}
      <div class="row g-2 align-items-end">
        <div class="col-lg-5">
          <label class="form-label small fw-semibold">User</label>
          <UserPicker
            value={user}
            onChange={setUser}
            disabled={saving}
            endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/users`}
          />
        </div>
        <div class="col-lg-3">
          <label class="form-label small fw-semibold" for="managed-group-leadership-role">
            Role
          </label>
          <select
            id="managed-group-leadership-role"
            class="form-select form-select-sm"
            value={roleId}
            disabled={saving}
            onChange={(event) =>
              setRoleId((event.target as HTMLSelectElement).value as GroupLeadershipAssignment["roleId"])
            }
          >
            {GROUP_LEADERSHIP_ROLE_IDS.map((id) => (
              <option key={id} value={id}>
                {GROUP_LEADERSHIP_ROLE_LABELS[id]}
              </option>
            ))}
          </select>
        </div>
        <div class="col-lg-3">
          <label class="form-label small fw-semibold" for="managed-group-leadership-expiry">
            Expires (optional)
          </label>
          <input
            id="managed-group-leadership-expiry"
            class="form-control form-control-sm"
            type="datetime-local"
            value={expiresAt}
            disabled={saving}
            onInput={(event) => setExpiresAt((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-lg-1">
          <button class="btn btn-sm btn-success w-100" type="submit" disabled={saving || !user}>
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </form>
  );
}
