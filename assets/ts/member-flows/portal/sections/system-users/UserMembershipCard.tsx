import { useState } from "preact/hooks";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  memberCapacityMutationResponseSchema,
} from "../../../../../shared/schemas/membership-management";
import { MEMBER_STATUSES } from "../../../../../shared/schemas/membership-categories";
import { deleteJson, patchJson } from "../../../../shared/api-client";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { fmtDate, toast } from "../../ui";
import { Badge, statusLabel } from "../../../../components/Badge";
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
  const [editingProfile, setEditingProfile] = useState(false);
  const [jobTitle, setJobTitle] = useState(membership.jobTitle ?? "");
  const [biography, setBiography] = useState(membership.biography ?? "");
  const [links, setLinks] = useState(membership.links);

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

  async function endIdentity() {
    const target = membership.organizationName ?? "this individual identity";
    const confirmed = await confirmAction({
      title: `End the identity for ${target}?`,
      body: "Their user account and other identities are kept.",
      consequences: ["This acting identity and its group participation end", "Their user account and sign-in remain"],
      confirmLabel: "End identity",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      if (membership.organizationId) {
        await patchJson(
          `/api/v1/organizations/${encodeURIComponent(membership.organizationId)}/identities/${encodeURIComponent(membership.identityId)}`,
          { transition: { state: "ended", reason: "Ended from System Users" } },
          identityMutationResponseSchema,
        );
      } else {
        await deleteJson(
          `/api/v1/members/capacities/${encodeURIComponent(membership.memberId)}`,
          successResponseSchema,
        );
      }
      toast("Identity ended", "success");
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveIdentityProfile() {
    if (!membership.organizationId) return;
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(membership.organizationId)}/identities/${encodeURIComponent(membership.identityId)}`,
        { profile: { jobTitle: jobTitle.trim() || null, biography: biography.trim() || null, links } },
        identityMutationResponseSchema,
      );
      toast("Identity profile updated", "success");
      setEditingProfile(false);
      await onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  function toggleIdentityEditor() {
    if (!editingProfile) {
      setJobTitle(membership.jobTitle ?? "");
      setBiography(membership.biography ?? "");
      setLinks(membership.links);
    }
    setEditingProfile((current) => !current);
  }

  return (
    <div class="border rounded p-3">
      <table class="table table-sm table-borderless mb-2">
        <tbody>
          <tr>
            <th class="text-muted small adm-user-info-label">Organization</th>
            <td>{membership.organizationName ?? <span class="fst-italic text-muted">Individual member</span>}</td>
          </tr>
          {membership.organizationId && (
            <tr>
              <th class="text-muted small adm-user-info-label">Identity email</th>
              <td>{membership.email}</td>
            </tr>
          )}
          {membership.organizationId && (
            <tr>
              <th class="text-muted small adm-user-info-label">Job title</th>
              <td>{membership.jobTitle || "—"}</td>
            </tr>
          )}
          {membership.biography && (
            <tr>
              <th class="text-muted small adm-user-info-label">Biography</th>
              <td>{membership.biography}</td>
            </tr>
          )}
          {membership.links.length > 0 && (
            <tr>
              <th class="text-muted small adm-user-info-label">Links</th>
              <td>
                {membership.links.map((url) => (
                  <a class="d-block small" key={url} href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                ))}
              </td>
            </tr>
          )}
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
                <Badge status={membership.status} />
              ) : (
                <select
                  class="form-select form-select-sm d-inline-block w-auto"
                  value={membership.status}
                  disabled={busy || !canManage}
                  onChange={(event) => void patchMember({ status: (event.target as HTMLSelectElement).value })}
                >
                  {MEMBER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
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
                    void patchJson(
                      `/api/v1/organizations/${encodeURIComponent(membership.organizationId!)}/identities/${encodeURIComponent(membership.identityId)}`,
                      { profile: { showOnOrganizationProfile: (event.target as HTMLInputElement).checked } },
                      identityMutationResponseSchema,
                    )
                      .then(async () => {
                        toast("Identity visibility updated", "success");
                        await onChanged();
                      })
                      .catch((error) => toast((error as Error).message, "error"))
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
            <td>{fmtDate(membership.createdAt)}</td>
          </tr>
        </tbody>
      </table>
      {editingProfile && membership.organizationId && (
        <div class="border-top pt-3 mb-3">
          <div class="row g-2">
            <div class="col-md-6">
              <label class="form-label small" for={`identity-job-title-${membership.identityId}`}>
                Job title for {membership.organizationName ?? "this organization"}
              </label>
              <input
                id={`identity-job-title-${membership.identityId}`}
                class="form-control form-control-sm"
                value={jobTitle}
                onInput={(event) => setJobTitle(event.currentTarget.value)}
                disabled={busy}
              />
            </div>
            <div class="col-md-6">
              <label class="form-label small">
                Profile links for {membership.organizationName ?? "this organization"}
              </label>
              <ProfileLinksInput
                fieldName={`identity.${membership.identityId}.links`}
                value={links}
                onChange={setLinks}
              />
            </div>
            <div class="col-12">
              <label class="form-label small" for={`identity-biography-${membership.identityId}`}>
                Biography for {membership.organizationName ?? "this organization"}
              </label>
              <textarea
                id={`identity-biography-${membership.identityId}`}
                class="form-control form-control-sm"
                rows={3}
                value={biography}
                onInput={(event) => setBiography(event.currentTarget.value)}
                disabled={busy}
              />
            </div>
          </div>
          <div class="d-flex gap-2 mt-2">
            <button class="btn btn-sm btn-primary" type="button" disabled={busy} onClick={saveIdentityProfile}>
              {busy ? "Saving…" : "Save identity profile"}
            </button>
            <button
              class="btn btn-sm btn-outline-secondary"
              type="button"
              disabled={busy}
              onClick={() => setEditingProfile(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {canManage && (
        <div class="d-flex gap-2">
          {membership.organizationId && (
            <button class="btn btn-sm btn-outline-primary" type="button" disabled={busy} onClick={toggleIdentityEditor}>
              {editingProfile ? "Close identity editor" : "Edit identity profile"}
            </button>
          )}
          <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={endIdentity}>
            End identity
          </button>
        </div>
      )}
    </div>
  );
}
