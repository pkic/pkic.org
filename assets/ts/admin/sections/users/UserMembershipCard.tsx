import { useState } from "preact/hooks";
import { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../../shared/schemas/admin-members";
import { MEMBER_STATUSES } from "../../../../shared/schemas/admin-organizations";
import { adminMemberMutationResponseSchema } from "../../../../shared/schemas/admin-members";
import { api, apiCommand } from "../../api";
import { fmt, toast } from "../../ui";
import type { UserMembership } from "./model";

export function UserMembershipCard({
  membership,
  onChanged,
}: {
  membership: UserMembership;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  async function patchMember(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/api/v1/admin/members/${membership.memberId}`, adminMemberMutationResponseSchema, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      toast("Membership updated", "success");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMembership() {
    if (!confirm("Remove this person's membership? Their user account is not deleted.")) return;
    setBusy(true);
    try {
      await apiCommand(`/api/v1/admin/members/${membership.memberId}`, { method: "DELETE" });
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
              {membership.organizationId ? (
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
              <select
                class="form-select form-select-sm d-inline-block w-auto"
                value={membership.status}
                disabled={busy}
                onChange={(event) => void patchMember({ status: (event.target as HTMLSelectElement).value })}
              >
                {MEMBER_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
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
                  disabled={busy}
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
      <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={removeMembership}>
        Remove membership
      </button>
    </div>
  );
}
