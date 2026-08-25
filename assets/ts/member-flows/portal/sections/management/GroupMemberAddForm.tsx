import { useState } from "preact/hooks";
import { groupMemberAddSchema, groupMembershipMutationResponseSchema } from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { ApiClientError, postJson } from "../../../../shared/api-client";

export function GroupMemberAddForm({ groupId, onAdded }: { groupId: string; onAdded: () => Promise<void> }) {
  const [user, setUser] = useState<PickedUser | null>(null);
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
      const input = groupMemberAddSchema.parse({
        userId: user.id,
        capacitySelection: { mode: "all_eligible", confirmed: true },
      });
      await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/memberships/${encodeURIComponent(input.userId)}`,
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
    <form class="border rounded p-3 d-flex flex-column gap-3" onSubmit={submit}>
      <div>
        <h6 class="mb-1">Add a person</h6>
        <p class="text-muted small mb-0">
          The person joins through every currently eligible Member affiliation. Existing capacities remain unchanged.
        </p>
      </div>
      {error && <ErrorAlert error={error} />}
      {saved && <div class="alert alert-success mb-0">Group participation added.</div>}
      <div class="row g-2 align-items-end">
        <div class="col-lg-10">
          <label class="form-label small fw-semibold">User</label>
          <UserPicker value={user} onChange={setUser} disabled={saving} />
        </div>
        <div class="col-lg-2">
          <button class="btn btn-sm btn-success w-100" type="submit" disabled={saving || !user}>
            {saving ? "Adding…" : "Add to group"}
          </button>
        </div>
      </div>
    </form>
  );
}
