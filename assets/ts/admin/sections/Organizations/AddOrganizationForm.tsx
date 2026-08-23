/**
 * Add organization (or org-less individual) — Interim Admin Tool.
 * Split out of Organizations.tsx (PR #1 review).
 */
import { useState } from "preact/hooks";
import { apiCommand } from "../../api";
import { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../../shared/schemas/admin-members";
import type { AdminWorkingGroupSummary } from "../../../../shared/schemas/working-groups";
import { ProfileLinksInput } from "../../../components/ProfileLinksInput";
import { activeAdminWorkingGroupCatalog } from "../../services/catalogs";
import { performAdminAction } from "../../actions";
import { FormActions } from "../../components/FormActions";
import { ServerSearchSelect } from "../../components/ServerSearchSelect";

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
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(membershipCategory);

  function updateRep(index: number, patch: Partial<RepresentativeDraft>) {
    setRepresentatives((reps) => reps.map((rep, i) => (i === index ? { ...rep, ...patch } : rep)));
  }

  function addRep() {
    setRepresentatives((reps) => [...reps, emptyRepresentative()]);
  }

  function removeRep(index: number) {
    setRepresentatives((reps) => (reps.length > 1 ? reps.filter((_, i) => i !== index) : reps));
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

    setStatus("Saving…");
    const body: Record<string, unknown> = {
      membershipCategory,
      memberSince,
      representatives: representatives.map((representative) => ({
        name: representative.name.trim(),
        email: representative.email.trim(),
        ...(representative.role.trim() ? { role: representative.role.trim() } : {}),
        ...(representative.links.length > 0 ? { links: representative.links } : {}),
      })),
      workingGroupSlugs: workingGroups.map((group) => group.slug),
    };
    if (!isIndividual) {
      body.organizationName = organizationName.trim();
      if (website.trim()) body.website = website.trim();
      if (description.trim()) body.description = description.trim();
    }
    await performAdminAction({
      setBusy: setSaving,
      request: () => apiCommand("/api/v1/admin/members", { method: "POST", body: JSON.stringify(body) }),
      successMessage: isIndividual ? "Individual member created" : "Organization created",
      afterSuccess: onCreated,
      onError: setStatus,
    });
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
        <ServerSearchSelect
          catalog={activeAdminWorkingGroupCatalog()}
          label="Add working group"
          value={null}
          placeholder="Select a working group…"
          excludeValues={workingGroups.map((group) => group.id)}
          onChange={(group) => {
            if (group) setWorkingGroups((current) => [...current, group]);
          }}
        />
        <div class="d-flex flex-wrap gap-2 mt-2">
          {workingGroups.map((group) => (
            <button
              type="button"
              class="btn btn-sm btn-outline-secondary"
              key={group.id}
              aria-label={`Remove ${group.name}`}
              onClick={() => setWorkingGroups((current) => current.filter((item) => item.id !== group.id))}
            >
              {group.name} ×
            </button>
          ))}
        </div>
      </div>

      <FormActions
        submitLabel={isIndividual ? "Create individual member" : "Create organization"}
        busyLabel="Saving…"
        busy={saving}
        onCancel={onCancel}
        status={status}
      />
    </form>
  );
}
