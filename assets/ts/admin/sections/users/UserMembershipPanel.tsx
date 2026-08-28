import { useState } from "preact/hooks";
import { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../../shared/schemas/admin-members";
import { adminMemberMutationResponseSchema } from "../../../../shared/schemas/admin-members";
import {
  organizationDetailResponseSchema,
  organizationsListResponseSchema,
  type OrganizationSummary,
} from "../../../../shared/schemas/organization-management";
import { representativeMutationResponseSchema } from "../../../../shared/schemas/organization-representation";
import { api } from "../../api";
import { toast } from "../../ui";
import type { UserDetail } from "./model";
import { UserMembershipCard } from "./UserMembershipCard";

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
  const [orgResults, setOrgResults] = useState<OrganizationSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedOrgCategory, setSelectedOrgCategory] = useState<string | null | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isIndividual = mode !== GRANT_MODE_ORG_TIED;
  const mayGrantIndividual = user.memberships.length === 0;

  async function searchOrgs() {
    setSearching(true);
    try {
      const data = await api(
        `/api/v1/organizations?limit=10${orgQuery.trim() ? `&q=${encodeURIComponent(orgQuery.trim())}` : ""}`,
        organizationsListResponseSchema,
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
      const data = await api(`/api/v1/organizations/${orgId}`, organizationDetailResponseSchema);
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
        await api(`/api/v1/admin/users/${user.id}/membership`, adminMemberMutationResponseSchema, {
          method: "POST",
          body: JSON.stringify({ membershipCategory: mode }),
        });
      } else {
        await api(`/api/v1/organizations/${selectedOrgId}/representatives`, representativeMutationResponseSchema, {
          method: "POST",
          body: JSON.stringify({
            kind: "existing_user",
            userId: user.id,
            showOnOrganizationProfile: true,
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
            {mayGrantIndividual &&
              MEMBERSHIP_CATEGORIES.filter((category) => INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(category)).map(
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
  const hasIndividualMembership = user.memberships.some((membership) => membership.organizationId === null);

  return (
    <div class="card border-0 shadow-sm mt-4">
      <div class="card-header bg-white fw-semibold">Membership</div>
      <div class="card-body p-3">
        {user.memberships.length === 0 && !showGrantForm && <span class="text-muted fst-italic">Not a member.</span>}
        {user.memberships.length > 0 && (
          <div class="d-grid gap-3 mb-3">
            {user.memberships.map((membership) => (
              <UserMembershipCard key={membership.memberId} membership={membership} onChanged={onChanged} />
            ))}
          </div>
        )}
        {showGrantForm ? (
          <GrantMembershipForm
            user={user}
            onGranted={() => {
              setShowGrantForm(false);
              void onChanged();
            }}
            onCancel={() => setShowGrantForm(false)}
          />
        ) : !hasIndividualMembership ? (
          <button class="btn btn-sm btn-outline-success ms-2" onClick={() => setShowGrantForm(true)}>
            {user.memberships.length === 0 ? "Grant membership" : "Add organization representation"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
