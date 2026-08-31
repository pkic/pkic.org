import { useState } from "preact/hooks";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  memberCapacityMutationResponseSchema,
} from "../../../../../shared/schemas/membership-management";
import {
  organizationDetailResponseSchema,
  organizationsListResponseSchema,
  type OrganizationSummary,
} from "../../../../../shared/schemas/organization-management";
import { identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { getJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import type { UserDetail } from "./model";
import { UserMembershipCard } from "./UserMembershipCard";

const GRANT_MODE_ORG_TIED = "__org_tied__";

function GrantMembershipForm({
  user,
  canActivate,
  onGranted,
  onCancel,
}: {
  user: UserDetail;
  canActivate: boolean;
  onGranted: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<string>(GRANT_MODE_ORG_TIED);
  const [orgQuery, setOrgQuery] = useState("");
  const [orgResults, setOrgResults] = useState<OrganizationSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedOrgCategory, setSelectedOrgCategory] = useState<string | null | undefined>(undefined);
  const [activationReason, setActivationReason] = useState("");
  const [activateImmediately, setActivateImmediately] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isIndividual = mode !== GRANT_MODE_ORG_TIED;
  const mayGrantIndividual = canActivate && user.identities.length === 0;

  async function searchOrgs() {
    setSearching(true);
    try {
      const data = await getJson(
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
      const data = await getJson(`/api/v1/organizations/${orgId}`, organizationDetailResponseSchema);
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
    if ((isIndividual || activateImmediately) && !activationReason.trim()) {
      setError("Document why this identity is being activated immediately.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (isIndividual) {
        await postJson(
          "/api/v1/members/capacities",
          { userId: user.id, membershipCategory: mode, activationReason: activationReason.trim() },
          memberCapacityMutationResponseSchema,
        );
      } else {
        await postJson(
          `/api/v1/organizations/${selectedOrgId}/identities`,
          {
            userReference: "existing_user",
            userId: user.id,
            showOnOrganizationProfile: true,
            activation: activateImmediately
              ? { mode: "immediate", reason: activationReason.trim() }
              : { mode: "invitation" },
          },
          identityMutationResponseSchema,
        );
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
        {!isIndividual && canActivate && (
          <div class="col-md-3">
            <div class="form-check">
              <input
                id="identity-activate-immediately"
                class="form-check-input"
                type="checkbox"
                checked={activateImmediately}
                onChange={(event) => setActivateImmediately(event.currentTarget.checked)}
              />
              <label class="form-check-label small" for="identity-activate-immediately">
                Activate immediately
              </label>
            </div>
            <div class="form-text">Requires identities:activate. Otherwise the user must accept the invitation.</div>
          </div>
        )}
        {(isIndividual || activateImmediately) && (
          <div class="col-md-4">
            <label class="form-label small text-muted mb-1" for="identity-activation-reason">
              Activation reason
            </label>
            <input
              id="identity-activation-reason"
              class="form-control form-control-sm"
              value={activationReason}
              onInput={(event) => setActivationReason(event.currentTarget.value)}
              required
            />
          </div>
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

export function UserMembershipPanel({
  user,
  onChanged,
  canManage,
  canActivate,
}: {
  user: UserDetail;
  onChanged: () => Promise<void> | void;
  canManage: boolean;
  canActivate: boolean;
}) {
  const [showGrantForm, setShowGrantForm] = useState(false);
  const hasIndividualMembership = user.identities.some((identity) => identity.organizationId === null);

  return (
    <div class="card border-0 shadow-sm mt-4">
      <div class="card-header bg-white fw-semibold">Membership</div>
      <div class="card-body p-3">
        {user.identities.length === 0 && !showGrantForm && (
          <span class="text-muted fst-italic">No active identities.</span>
        )}
        {user.identities.length > 0 && (
          <div class="d-grid gap-3 mb-3">
            {user.identities.map((membership) => (
              <UserMembershipCard
                key={membership.identityId}
                membership={membership}
                onChanged={onChanged}
                canManage={canManage}
              />
            ))}
          </div>
        )}
        {canManage && showGrantForm ? (
          <GrantMembershipForm
            user={user}
            canActivate={canActivate}
            onGranted={() => {
              setShowGrantForm(false);
              void onChanged();
            }}
            onCancel={() => setShowGrantForm(false)}
          />
        ) : canManage && !hasIndividualMembership ? (
          <button class="btn btn-sm btn-outline-success ms-2" onClick={() => setShowGrantForm(true)}>
            Add identity
          </button>
        ) : null}
      </div>
    </div>
  );
}
