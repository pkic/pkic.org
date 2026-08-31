import { useState } from "preact/hooks";
import {
  GROUP_LEADERSHIP_ROLE_IDS,
  groupLeadershipAssignSchema,
  groupLeadershipListResponseSchema,
  groupMembershipsListResponseSchema,
  type GroupLeadershipAssignment,
  type GroupMembership,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { ApiClientError, postJson } from "../../../../shared/api-client";
import type { ServerCatalog } from "../../../../shared/server-catalog";
import { GROUP_LEADERSHIP_ROLE_LABELS } from "./group-leadership";

function capacityLabel(membership: GroupMembership): string {
  const capacity =
    membership.memberType === "organization"
      ? (membership.organizationName ?? "Organization")
      : `Individual membership${membership.membershipCategory ? ` (${membership.membershipCategory})` : ""}`;
  return `${membership.userName} — ${capacity}`;
}

function leadershipCapacityCatalog(groupId: string): ServerCatalog<GroupMembership, unknown> {
  return {
    endpoint: `/api/v1/groups/${encodeURIComponent(groupId)}/memberships`,
    params: { active: "true" },
    sort: "user_name",
    responseSchema: groupMembershipsListResponseSchema,
    resolveItems: (response) => groupMembershipsListResponseSchema.parse(response).memberships,
    resolvePage: (response) => groupMembershipsListResponseSchema.parse(response).page,
    itemKey: (membership) => membership.id,
    itemLabel: capacityLabel,
  };
}

export function GroupLeadershipAssignmentForm({
  groupId,
  onAssigned,
  onCancel,
}: {
  groupId: string;
  onAssigned: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [membership, setMembership] = useState<GroupMembership | null>(null);
  const [roleId, setRoleId] = useState<GroupLeadershipAssignment["roleId"]>("role-group_lead");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!membership) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const input = groupLeadershipAssignSchema.parse({
        userId: membership.userId,
        identityId: membership.identityId,
        roleId,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/leadership`,
        input,
        groupLeadershipListResponseSchema,
      );
      setMembership(null);
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
      <div class="d-flex justify-content-between align-items-start gap-2">
        <div>
          <h6 class="mb-1">Add local leadership</h6>
          <p class="text-muted small mb-0">
            Local assignments extend inherited leadership. An optional expiry ends the assignment automatically.
          </p>
        </div>
        {onCancel && (
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && <ErrorAlert error={error} />}
      {saved && <div class="alert alert-success mb-0">Leadership assignment added.</div>}
      <div class="row g-2 align-items-end">
        <div class="col-lg-5">
          <ServerSearchSelect
            catalog={leadershipCapacityCatalog(groupId)}
            label="Participation capacity"
            value={membership?.id ?? null}
            selectedLabel={membership ? capacityLabel(membership) : undefined}
            placeholder="Select a person and Member capacity…"
            searchPlaceholder="Search name, email, organization, or category…"
            onChange={setMembership}
            disabled={saving}
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
          <button class="btn btn-sm btn-success w-100" type="submit" disabled={saving || !membership}>
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </form>
  );
}
