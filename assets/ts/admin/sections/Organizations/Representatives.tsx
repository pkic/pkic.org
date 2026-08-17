/**
 * Representative roster: add-to-existing-organization form and the roster
 * row (status/visibility/contact-role editing, removal). Split out of
 * Organizations.tsx (PR #1 review).
 */
import { useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { api } from "../../api";
import { toast } from "../../ui";
import type { AdminOrganizationRepresentative } from "../../types";
import { MEMBER_STATUSES } from "../../../../shared/schemas/admin-organizations";

export function AddRepresentativeForm({
  organizationId,
  membershipCategory,
  onAdded,
  onCancel,
}: {
  organizationId: string;
  /** The organization's current category (organizations.membership_category) — every new rep inherits it. */
  membershipCategory: string | null;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(`/api/v1/admin/organizations/${organizationId}/members`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          ...(jobTitle.trim() ? { jobTitle: jobTitle.trim() } : {}),
          ...(linkedin.trim() ? { linkedin: linkedin.trim() } : {}),
        }),
      });
      toast("Representative added", "success");
      onAdded();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  if (!membershipCategory) {
    return (
      <div class="small text-danger">
        Set this organization's membership category (in the Profile section above) before adding representatives.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} class="row g-2 align-items-end">
      <div class="col-md-3">
        <label class="form-label small text-muted mb-1">Name</label>
        <input
          class="form-control form-control-sm"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Jane Doe"
          required
        />
      </div>
      <div class="col-md-3">
        <label class="form-label small text-muted mb-1">Email</label>
        <input
          class="form-control form-control-sm"
          type="email"
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          placeholder="jane@acme.example"
          required
        />
      </div>
      <div class="col-md-2">
        <label class="form-label small text-muted mb-1">Job title</label>
        <input
          class="form-control form-control-sm"
          value={jobTitle}
          onInput={(e) => setJobTitle((e.target as HTMLInputElement).value)}
          placeholder="CTO"
        />
      </div>
      <div class="col-md-2">
        <label class="form-label small text-muted mb-1">LinkedIn</label>
        <input
          class="form-control form-control-sm"
          type="url"
          value={linkedin}
          onInput={(e) => setLinkedin((e.target as HTMLInputElement).value)}
          placeholder="https://linkedin.com/in/..."
        />
      </div>
      <div class="col-md-1">
        <label class="form-label small text-muted mb-1">Category</label>
        <div class="mono small pt-1">{membershipCategory}</div>
      </div>
      <div class="col-md-1 d-flex gap-1">
        <button type="submit" class="btn btn-sm btn-success" disabled={saving}>
          Add
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel}>
          ×
        </button>
      </div>
      {error && (
        <div class="col-12">
          <span class="small text-danger">{error}</span>
        </div>
      )}
    </form>
  );
}

export function RepresentativeRow({ rep, onChanged }: { rep: AdminOrganizationRepresentative; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [, navigate] = useHashLocation();

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/api/v1/admin/members/${rep.representativeId}`, { method: "PATCH", body: JSON.stringify(body) });
      toast("Representative updated", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${rep.name} as a representative? Their user account is not deleted.`)) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/members/${rep.representativeId}`, { method: "DELETE" });
      toast("Representative removed", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <strong class="adm-cell-name">{rep.name}</strong>
        <br />
        <button
          type="button"
          class="btn btn-link p-0 mono text-muted small"
          onClick={() => navigate(`/users/detail/${rep.userId}`)}
          title="View user details"
        >
          {rep.email}
        </button>
        {rep.jobTitle && <div class="small text-muted">{rep.jobTitle}</div>}
      </td>
      <td>
        <select
          class="form-select form-select-sm"
          value={rep.status}
          disabled={busy}
          onChange={(e) => patch({ status: (e.target as HTMLSelectElement).value })}
        >
          {MEMBER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td class="text-center">
        <input
          type="checkbox"
          class="form-check-input"
          checked={rep.showOnOrgProfile}
          disabled={busy}
          onChange={(e) => patch({ showOnOrgProfile: (e.target as HTMLInputElement).checked })}
        />
      </td>
      <td class="small">
        {rep.isPrimaryContact && <span class="badge text-bg-primary me-1">Primary</span>}
        {rep.isSecondaryContact && <span class="badge text-bg-info">Secondary</span>}
      </td>
      <td>
        <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={remove}>
          Remove
        </button>
      </td>
    </tr>
  );
}
