/**
 * Add organization (or org-less individual) — Interim Admin Tool.
 * Split out of Organizations.tsx (PR #1 review).
 */
import { useEffect, useState } from "preact/hooks";
import { api } from "../../api";
import { toast } from "../../ui";
import { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../../shared/schemas/admin-members";
import type { AdminWorkingGroupSummary } from "../../../../shared/schemas/working-groups";
import { ProfileLinksInput } from "../../../components/ProfileLinksInput";
import { getAdminWorkingGroupCatalogue } from "../../services/catalogues";

// Kept for the "Add organization" (create) flow only — category is
// picked once there. Once an organization exists, its category lives at
// organizations.membership_category and is edited via the org profile form,
// not per-representative.

interface RepresentativeDraft {
  name: string;
  email: string;
  role: string;
  links: string[];
}

function emptyRepresentative(): RepresentativeDraft {
  return { name: "", email: "", role: "", links: [] };
}

export function AddOrganizationForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [organizationName, setOrganizationName] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [membershipCategory, setMembershipCategory] = useState<string>("F");
  const [memberSince, setMemberSince] = useState(() => new Date().toISOString().slice(0, 10));
  const [representatives, setRepresentatives] = useState<RepresentativeDraft[]>([emptyRepresentative()]);
  const [workingGroups, setWorkingGroups] = useState<AdminWorkingGroupSummary[]>([]);
  const [workingGroupsError, setWorkingGroupsError] = useState("");
  const [workingGroupSlugs, setWorkingGroupSlugs] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(membershipCategory);

  useEffect(() => {
    let active = true;
    void getAdminWorkingGroupCatalogue()
      .then((groups) => {
        if (active) setWorkingGroups(groups.filter((group) => group.active));
      })
      .catch((error: unknown) => {
        if (active) setWorkingGroupsError((error as Error).message);
      });
    return () => {
      active = false;
    };
  }, []);

  function updateRep(index: number, patch: Partial<RepresentativeDraft>) {
    setRepresentatives((reps) => reps.map((rep, i) => (i === index ? { ...rep, ...patch } : rep)));
  }

  function addRep() {
    setRepresentatives((reps) => [...reps, emptyRepresentative()]);
  }

  function removeRep(index: number) {
    setRepresentatives((reps) => (reps.length > 1 ? reps.filter((_, i) => i !== index) : reps));
  }

  function toggleWorkingGroup(slug: string) {
    setWorkingGroupSlugs((slugs) => {
      const next = new Set(slugs);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function handleCategoryChange(category: string) {
    setMembershipCategory(category);
    if (INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(category) && representatives.length > 1) {
      setRepresentatives((reps) => reps.slice(0, 1));
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!isIndividual && !organizationName.trim()) {
      setStatus("Organization name is required for org-tied categories.");
      return;
    }
    if (representatives.some((r) => !r.name.trim() || !r.email.trim())) {
      setStatus("Every representative needs a name and email.");
      return;
    }

    setSaving(true);
    setStatus("Saving…");
    try {
      const body: Record<string, unknown> = {
        membershipCategory,
        memberSince,
        representatives: representatives.map((r) => ({
          name: r.name.trim(),
          email: r.email.trim(),
          ...(r.role.trim() ? { role: r.role.trim() } : {}),
          ...(r.links.length > 0 ? { links: r.links } : {}),
        })),
        workingGroupSlugs: Array.from(workingGroupSlugs),
      };
      if (!isIndividual) {
        body.organizationName = organizationName.trim();
        if (website.trim()) body.website = website.trim();
        if (description.trim()) body.description = description.trim();
      }

      await api("/api/v1/admin/members", { method: "POST", body: JSON.stringify(body) });
      toast(isIndividual ? "Individual member created" : "Organization created", "success");
      onCreated();
    } catch (err) {
      const msg = (err as Error).message;
      setStatus(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div class="row g-2 mb-2">
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Membership category *</label>
          <select
            class="form-select form-select-sm"
            value={membershipCategory}
            onChange={(e) => handleCategoryChange((e.target as HTMLSelectElement).value)}
          >
            {MEMBERSHIP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Member since *</label>
          <input
            class="form-control form-control-sm"
            type="date"
            value={memberSince}
            onInput={(e) => setMemberSince((e.target as HTMLInputElement).value)}
            required
          />
        </div>
      </div>

      {!isIndividual && (
        <div class="row g-2 mb-2">
          <div class="col-md-4">
            <label class="form-label small fw-semibold">Organization name *</label>
            <input
              class="form-control form-control-sm"
              type="text"
              value={organizationName}
              onInput={(e) => setOrganizationName((e.target as HTMLInputElement).value)}
              placeholder="Acme Corp"
              required
            />
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-semibold">Website</label>
            <input
              class="form-control form-control-sm"
              type="url"
              value={website}
              onInput={(e) => setWebsite((e.target as HTMLInputElement).value)}
              placeholder="https://acme.example"
            />
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-semibold">Description</label>
            <input
              class="form-control form-control-sm"
              type="text"
              value={description}
              onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
              placeholder="Short description"
            />
          </div>
        </div>
      )}

      <div class="mb-2">
        <label class="form-label small fw-semibold mb-1">
          {isIndividual ? "Representative *" : "Representatives *"}
        </label>
        {representatives.map((rep, i) => (
          <div class="row g-2 mb-2 align-items-end" key={i}>
            <div class="col-md-3">
              {i === 0 && <label class="form-label small text-muted">Name</label>}
              <input
                class="form-control form-control-sm"
                type="text"
                value={rep.name}
                onInput={(e) => updateRep(i, { name: (e.target as HTMLInputElement).value })}
                placeholder="Jane Doe"
                required
              />
            </div>
            <div class="col-md-3">
              {i === 0 && <label class="form-label small text-muted">Email</label>}
              <input
                class="form-control form-control-sm"
                type="email"
                value={rep.email}
                onInput={(e) => updateRep(i, { email: (e.target as HTMLInputElement).value })}
                placeholder="jane@acme.example"
                required
              />
            </div>
            <div class="col-md-2">
              {i === 0 && <label class="form-label small text-muted">Role / title</label>}
              <input
                class="form-control form-control-sm"
                type="text"
                value={rep.role}
                onInput={(e) => updateRep(i, { role: (e.target as HTMLInputElement).value })}
                placeholder="CTO"
              />
            </div>
            <div class="col-md-3">
              {i === 0 && <label class="form-label small text-muted">Profile links</label>}
              <ProfileLinksInput
                fieldName={`representatives.${i}.links`}
                value={rep.links}
                onChange={(links) => updateRep(i, { links })}
                max={15}
              />
            </div>
            <div class="col-md-1">
              {!isIndividual && representatives.length > 1 && (
                <button
                  type="button"
                  class="btn btn-sm btn-outline-danger w-100"
                  onClick={() => removeRep(i)}
                  aria-label="Remove representative"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
        {!isIndividual && (
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={addRep}>
            + Add representative
          </button>
        )}
      </div>

      <div class="mb-3">
        <label class="form-label small fw-semibold mb-1">Working groups</label>
        <div class="d-flex flex-wrap gap-3">
          {workingGroups.map((group) => (
            <div class="form-check" key={group.id}>
              <input
                class="form-check-input"
                type="checkbox"
                id={`wg-${group.id}`}
                checked={workingGroupSlugs.has(group.slug)}
                onChange={() => toggleWorkingGroup(group.slug)}
              />
              <label class="form-check-label small" for={`wg-${group.id}`}>
                {group.name}
              </label>
            </div>
          ))}
        </div>
        {workingGroupsError && <div class="small text-danger mt-1">{workingGroupsError}</div>}
      </div>

      <div class="d-flex gap-2 align-items-center">
        <button type="submit" class="btn btn-sm btn-success" disabled={saving}>
          {isIndividual ? "Create individual member" : "Create organization"}
        </button>
        <button type="button" class="btn btn-sm btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        {status && <span class="small text-muted">{status}</span>}
      </div>
    </form>
  );
}
