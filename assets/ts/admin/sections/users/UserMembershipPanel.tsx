import { useState } from "preact/hooks";
import { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../../shared/schemas/admin-members";
import { MEMBER_STATUSES } from "../../../../shared/schemas/admin-organizations";
import { api } from "../../api";
import { fmt, toast } from "../../ui";
import type { AdminOrganizationSummary } from "../../types";
import type { UserDetail } from "./model";

const GRANT_MODE_ORG_TIED = "__org_tied__";

function GrantMembershipForm({
  user,
  onGranted,
  onCancel,
}: {
  user: UserDetail;
  onGranted: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<string>(GRANT_MODE_ORG_TIED);
  const [orgQuery, setOrgQuery] = useState("");
  const [orgResults, setOrgResults] = useState<AdminOrganizationSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedOrgCategory, setSelectedOrgCategory] = useState<string | null | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isIndividual = mode !== GRANT_MODE_ORG_TIED;
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;

  async function searchOrgs() {
    setSearching(true);
    try {
      const data = await api<{ organizations: AdminOrganizationSummary[] }>(
        `/api/v1/admin/organizations?limit=10${orgQuery.trim() ? `&q=${encodeURIComponent(orgQuery.trim())}` : ""}`,
      );
      setOrgResults(data.organizations);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setSearching(false);
    }
  }

  async function pickOrg(orgId: string) {
    setSelectedOrgId(orgId);
    setSelectedOrgCategory(undefined);
    if (!orgId) return;
    try {
      const data = await api<{ organization: { membershipCategory: string | null } }>(
        `/api/v1/admin/organizations/${orgId}`,
      );
      setSelectedOrgCategory(data.organization.membershipCategory);
    } catch (error) {
      toast((error as Error).message, "error");
    }
  }

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (!isIndividual && !selectedOrgId) {
      setError("Pick an organization.");
      return;
    }
    if (!isIndividual && !selectedOrgCategory) {
      setError("This organization has no membership category set yet — set it in Organizations first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (isIndividual) {
        await api(`/api/v1/admin/users/${user.id}/membership`, {
          method: "POST",
          body: JSON.stringify({ membershipCategory: mode }),
        });
      } else {
        await api(`/api/v1/admin/organizations/${selectedOrgId}/members`, {
          method: "POST",
          body: JSON.stringify({
            name: displayName,
            email: user.email,
            ...(user.job_title ? { jobTitle: user.job_title } : {}),
          }),
        });
      }
      toast("Membership granted", "success");
      onGranted();
    } catch (error) {
      const message = (error as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div class="row g-2 align-items-end">
        <div class="col-md-3">
          <label class="form-label small text-muted mb-1">Category</label>
          <select
            class="form-select form-select-sm"
            value={mode}
            onChange={(event) => setMode((event.target as HTMLSelectElement).value)}
          >
            <option value={GRANT_MODE_ORG_TIED}>Organization-tied (set by org)</option>
            {MEMBERSHIP_CATEGORIES.filter((category) => INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(category)).map(
              (category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ),
            )}
          </select>
        </div>
        {!isIndividual && (
          <>
            <div class="col-md-4">
              <label class="form-label small text-muted mb-1">Find organization</label>
              <div class="d-flex gap-1">
                <input
                  class="form-control form-control-sm"
                  value={orgQuery}
                  onInput={(event) => setOrgQuery((event.target as HTMLInputElement).value)}
                  placeholder="Organization name"
                />
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  disabled={searching}
                  onClick={searchOrgs}
                >
                  Search
                </button>
              </div>
            </div>
            <div class="col-md-3">
              <label class="form-label small text-muted mb-1">Organization</label>
              <select
                class="form-select form-select-sm"
                value={selectedOrgId}
                onChange={(event) => void pickOrg((event.target as HTMLSelectElement).value)}
              >
                <option value="">— Pick —</option>
                {orgResults.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
              {selectedOrgId && selectedOrgCategory !== undefined && (
                <div class="form-text">
                  {selectedOrgCategory
                    ? `Category: ${selectedOrgCategory}`
                    : "No category set on this organization yet."}
                </div>
              )}
            </div>
          </>
        )}
        <div class="col-md-2">
          <button type="submit" class="btn btn-sm btn-success" disabled={saving}>
            Grant
          </button>{" "}
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
      {error && <div class="small text-danger mt-2">{error}</div>}
    </form>
  );
}

export function UserMembershipPanel({ user, onChanged }: { user: UserDetail; onChanged: () => Promise<void> | void }) {
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const membership = user.membership;

  async function patchMember(body: Record<string, unknown>) {
    if (!membership) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/members/${membership.memberId}`, { method: "PATCH", body: JSON.stringify(body) });
      toast("Membership updated", "success");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMembership() {
    if (!membership) return;
    if (!confirm("Remove this person's membership? Their user account is not deleted.")) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/members/${membership.memberId}`, { method: "DELETE" });
      toast("Membership removed", "success");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm mt-4">
      <div class="card-header bg-white fw-semibold">Membership</div>
      <div class="card-body p-3">
        {!membership ? (
          <>
            {!showGrantForm ? (
              <div class="d-flex align-items-center gap-2">
                <span class="text-muted fst-italic">Not a member.</span>
                <button class="btn btn-sm btn-outline-success" onClick={() => setShowGrantForm(true)}>
                  Grant membership
                </button>
              </div>
            ) : (
              <GrantMembershipForm
                user={user}
                onGranted={() => {
                  setShowGrantForm(false);
                  void onChanged();
                }}
                onCancel={() => setShowGrantForm(false)}
              />
            )}
          </>
        ) : (
          <div>
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
                  <th class="text-muted small adm-user-info-label">Working groups</th>
                  <td>
                    {membership.workingGroups.length > 0
                      ? membership.workingGroups.map((workingGroup) => workingGroup.name).join(", ")
                      : "—"}
                  </td>
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
        )}
      </div>
    </div>
  );
}
