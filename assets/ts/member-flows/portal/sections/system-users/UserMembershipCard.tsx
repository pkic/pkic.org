import { useState } from "preact/hooks";
import { confirmAction } from "../../../../components/ConfirmDialog";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  memberCapacityMutationResponseSchema,
} from "../../../../../shared/schemas/membership-management";
import { MEMBER_STATUSES } from "../../../../../shared/schemas/membership-categories";
import { deleteJson, patchJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { fmt, toast } from "../../ui";
import type { UserMembership } from "./model";

export function UserMembershipCard({
  membership,
  onChanged,
  canManage,
}: {
  membership: UserMembership;
  onChanged: () => Promise<void> | void;
  canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function patchMember(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/members/capacities/${encodeURIComponent(membership.memberId)}`,
        body,
        memberCapacityMutationResponseSchema,
      );
      toast("Membership updated", "success");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMembership() {
    const target = membership.organizationName ?? "this individual membership";
    const confirmed = await confirmAction({
      title: `Remove the membership for ${target}?`,
      body: "Their user account is kept.",
      consequences: [
        "This membership capacity and its group memberships are removed",
        "Their user account and sign-in remain",
      ],
      confirmLabel: "Remove membership",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await deleteJson(`/api/v1/members/capacities/${encodeURIComponent(membership.memberId)}`, successResponseSchema);
      toast("Membership removed", "success");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="border rounded p-3">
      <table class="table table-sm table-borderless mb-2">
        <tbody>
          <tr>
            <th class="text-muted small adm-user-info-label">Organization</th>
            <td>{membership.organizationName ?? <span class="fst-italic text-muted">Individual member</span>}</td>
          </tr>
          <tr>
            <th class="text-muted small adm-user-info-label">Category</th>
            <td>
              {membership.organizationId || !canManage ? (
                <span class="badge text-bg-success mono">{membership.membershipCategory}</span>
              ) : (
                <select
                  class="form-select form-select-sm d-inline-block w-auto"
                  value={membership.membershipCategory}
                  disabled={busy}
                  onChange={(event) =>
                    void patchMember({ membershipCategory: (event.target as HTMLSelectElement).value })
                  }
                >
                  {MEMBERSHIP_CATEGORIES.filter((category) => INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(category)).map(
                    (category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ),
                  )}
                </select>
              )}
            </td>
          </tr>
          <tr>
            <th class="text-muted small adm-user-info-label">Status</th>
            <td>
              {membership.organizationId ? (
                <span class="badge text-bg-secondary">{membership.status}</span>
              ) : (
                <select
                  class="form-select form-select-sm d-inline-block w-auto"
                  value={membership.status}
                  disabled={busy || !canManage}
                  onChange={(event) => void patchMember({ status: (event.target as HTMLSelectElement).value })}
                >
                  {MEMBER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              )}
            </td>
          </tr>
          {membership.organizationId && (
            <tr>
              <th class="text-muted small adm-user-info-label">Show on org profile</th>
              <td>
                <input
                  type="checkbox"
                  class="form-check-input"
                  checked={membership.showOnOrgProfile}
                  disabled={busy || !canManage}
                  onChange={(event) =>
                    void patchMember({ showOnOrgProfile: (event.target as HTMLInputElement).checked })
                  }
                />
              </td>
            </tr>
          )}
          <tr>
            <th class="text-muted small adm-user-info-label">Groups</th>
            <td>{membership.groups.length > 0 ? membership.groups.map((group) => group.name).join(", ") : "—"}</td>
          </tr>
          <tr>
            <th class="text-muted small adm-user-info-label">Member since</th>
            <td>{fmt(membership.createdAt)}</td>
          </tr>
        </tbody>
      </table>
      {canManage && (
        <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={removeMembership}>
          Remove membership
        </button>
      )}
    </div>
  );
}
