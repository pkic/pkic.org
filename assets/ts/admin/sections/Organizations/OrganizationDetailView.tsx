/**
 * Organization detail view: profile card, logo, contacts, and
 * representative roster. Split out of Organizations.tsx (PR #1 review).
 */
import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { api } from "../../api";
import { toast, fmt } from "../../ui";
import type { AdminOrganizationDetail } from "../../types";
import { AddRepresentativeForm, RepresentativeRow } from "./Representatives";
import { OrganizationProfileForm } from "./OrganizationProfileForm";
import { OrganizationLogo } from "./OrganizationLogo";

export function OrganizationDetailView({ organizationId, onBack }: { organizationId: string; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState<AdminOrganizationDetail | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [showAddRep, setShowAddRep] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ organization: AdminOrganizationDetail }>(
        `/api/v1/admin/organizations/${organizationId}`,
      );
      setOrg(data.organization);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateContact(field: "primaryContactUserId" | "secondaryContactUserId", userId: string) {
    try {
      await api(`/api/v1/admin/organizations/${organizationId}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: userId || null }),
      });
      toast("Contact updated", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!org) return null;

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={onBack}>
          ← Back to list
        </button>
        <span class="page-heading mb-0">{org.name}</span>
        <span class="text-muted small">
          {org.memberCount} representative{org.memberCount === 1 ? "" : "s"}
        </span>
      </div>

      <div class="row g-4 mb-4">
        <div class="col-md-3">
          <OrganizationLogo org={org} onChanged={load} />
        </div>
        <div class="col-md-9">
          <div class="card border-0 shadow-sm">
            <div class="card-header bg-white fw-semibold d-flex justify-content-between align-items-center">
              Profile
              {!editingProfile && (
                <button class="btn btn-sm btn-outline-primary" onClick={() => setEditingProfile(true)}>
                  Edit
                </button>
              )}
            </div>
            <div class="card-body p-3">
              {editingProfile ? (
                <OrganizationProfileForm
                  org={org}
                  onSaved={() => {
                    setEditingProfile(false);
                    void load();
                  }}
                  onCancel={() => setEditingProfile(false)}
                />
              ) : (
                <table class="table table-sm table-borderless mb-0">
                  <tbody>
                    <tr>
                      <th class="text-muted small adm-user-info-label">Membership category</th>
                      <td>
                        {org.membershipCategory ? (
                          <span class="badge text-bg-success mono">{org.membershipCategory}</span>
                        ) : (
                          <span class="text-danger fst-italic">Not set</span>
                        )}
                      </td>
                    </tr>
                    {(
                      [
                        ["Website", org.website],
                        ["Slogan", org.slogan],
                        ["Description", org.description],
                        ["Blog", org.blogUrl],
                        ["Press", org.pressUrl],
                        ["Careers", org.careersUrl],
                      ] as Array<[string, string | null]>
                    ).map(([label, value]) => (
                      <tr key={label}>
                        <th class="text-muted small adm-user-info-label">{label}</th>
                        <td>{value || "—"}</td>
                      </tr>
                    ))}
                    <tr>
                      <th class="text-muted small adm-user-info-label">Member since</th>
                      <td>{fmt(org.memberSince)}</td>
                    </tr>
                    <tr>
                      <th class="text-muted small adm-user-info-label">Created</th>
                      <td>{fmt(org.createdAt)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      <div class="card border-0 shadow-sm mb-4">
        <div class="card-header bg-white fw-semibold">Contacts</div>
        <div class="card-body p-3">
          <div class="row g-2">
            <div class="col-md-6">
              <label class="form-label small mb-1">Primary contact</label>
              <select
                class="form-select form-select-sm"
                value={org.primaryContactUserId ?? ""}
                onChange={(e) => void updateContact("primaryContactUserId", (e.target as HTMLSelectElement).value)}
              >
                <option value="">— None —</option>
                {org.representatives.map((r) => (
                  <option key={r.userId} value={r.userId}>
                    {r.name} ({r.email})
                  </option>
                ))}
              </select>
            </div>
            <div class="col-md-6">
              <label class="form-label small mb-1">Secondary contact</label>
              <select
                class="form-select form-select-sm"
                value={org.secondaryContactUserId ?? ""}
                onChange={(e) => void updateContact("secondaryContactUserId", (e.target as HTMLSelectElement).value)}
              >
                <option value="">— None —</option>
                {org.representatives.map((r) => (
                  <option key={r.userId} value={r.userId}>
                    {r.name} ({r.email})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="card border-0 shadow-sm">
        <div class="card-header bg-white fw-semibold d-flex justify-content-between align-items-center">
          Representatives
          <button class="btn btn-sm btn-success" onClick={() => setShowAddRep((v) => !v)}>
            {showAddRep ? "Cancel" : "+ Add representative"}
          </button>
        </div>
        {showAddRep && (
          <div class="card-body border-bottom p-3">
            <AddRepresentativeForm
              organizationId={organizationId}
              membershipCategory={org.membershipCategory}
              onAdded={() => {
                setShowAddRep(false);
                void load();
              }}
              onCancel={() => setShowAddRep(false)}
            />
          </div>
        )}
        <div class="tbl-wrap">
          <table class="table table-sm table-hover mb-0">
            <thead class="table-dark">
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th class="text-center">On profile</th>
                <th>Contact role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {org.representatives.length === 0 ? (
                <tr>
                  <td colspan={5} class="text-center text-muted fst-italic py-3">
                    No representatives
                  </td>
                </tr>
              ) : (
                org.representatives.map((rep) => <RepresentativeRow key={rep.memberId} rep={rep} onChanged={load} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
