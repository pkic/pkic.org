/**
 * Admin → Organizations. Manages an organization's public profile
 * (description, content, logo, socials, blog/press/careers) and its
 * representative roster once the organization exists — whether it was
 * created here, via §6 Step 2 migration, or via application approval
 * (§4.7). New organizations are still created via the same §6 Interim
 * Admin Tool flow (`POST /api/v1/admin/members`); this section manages
 * them afterward.
 */
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { ApiDataTable, type ApiTableActions } from "../../components/Table";
import { api } from "../api";
import { toast, fmt } from "../ui";
import type { AdminOrganizationSummary, AdminOrganizationDetail, AdminOrganizationRepresentative } from "../types";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  WORKING_GROUP_SLUGS,
} from "../../../shared/schemas/admin-members";
import { ORG_TIED_MEMBERSHIP_CATEGORIES, MEMBER_STATUSES } from "../../../shared/schemas/admin-organizations";

// Kept for the §6 "Add organization" (create) flow only — category is
// picked once there. Once an organization exists, its category lives at
// organizations.membership_category and is edited via the org profile form
// below, not per-representative.

// ────────────────────────────────────────────────────────
// Add organization (or org-less individual) — §6 Interim Admin Tool
// ────────────────────────────────────────────────────────

interface RepresentativeDraft {
  name: string;
  email: string;
  role: string;
  linkedin: string;
}

function emptyRepresentative(): RepresentativeDraft {
  return { name: "", email: "", role: "", linkedin: "" };
}

function AddOrganizationForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [organizationName, setOrganizationName] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [membershipCategory, setMembershipCategory] = useState<string>("F");
  const [memberSince, setMemberSince] = useState(() => new Date().toISOString().slice(0, 10));
  const [representatives, setRepresentatives] = useState<RepresentativeDraft[]>([emptyRepresentative()]);
  const [workingGroupSlugs, setWorkingGroupSlugs] = useState<Set<string>>(new Set());
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
          ...(r.linkedin.trim() ? { linkedin: r.linkedin.trim() } : {}),
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
              {i === 0 && <label class="form-label small text-muted">LinkedIn</label>}
              <input
                class="form-control form-control-sm"
                type="url"
                value={rep.linkedin}
                onInput={(e) => updateRep(i, { linkedin: (e.target as HTMLInputElement).value })}
                placeholder="https://linkedin.com/in/..."
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
          {WORKING_GROUP_SLUGS.map((slug) => (
            <div class="form-check" key={slug}>
              <input
                class="form-check-input"
                type="checkbox"
                id={`wg-${slug}`}
                checked={workingGroupSlugs.has(slug)}
                onChange={() => toggleWorkingGroup(slug)}
              />
              <label class="form-check-label small text-uppercase mono" for={`wg-${slug}`}>
                {slug}
              </label>
            </div>
          ))}
        </div>
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

// ────────────────────────────────────────────────────────
// Add representative to an existing organization
// ────────────────────────────────────────────────────────

function AddRepresentativeForm({
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

// ────────────────────────────────────────────────────────
// Representatives roster
// ────────────────────────────────────────────────────────

function RepresentativeRow({ rep, onChanged }: { rep: AdminOrganizationRepresentative; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api(`/api/v1/admin/members/${rep.memberId}`, { method: "PATCH", body: JSON.stringify(body) });
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
      await api(`/api/v1/admin/members/${rep.memberId}`, { method: "DELETE" });
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
        <span class="mono text-muted small">{rep.email}</span>
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

// ────────────────────────────────────────────────────────
// Organization profile edit form
// ────────────────────────────────────────────────────────

const PROFILE_TEXT_FIELDS: Array<[label: string, field: keyof AdminOrganizationDetail]> = [
  ["Name", "name"],
  ["Slogan", "slogan"],
  ["Website", "website"],
  ["Blog URL", "blogUrl"],
  ["Blog feed URL", "blogFeedUrl"],
  ["Press URL", "pressUrl"],
  ["Press feed URL", "pressFeedUrl"],
  ["Careers URL", "careersUrl"],
  ["X / Twitter", "socialX"],
  ["LinkedIn", "socialLinkedin"],
  ["Facebook", "socialFacebook"],
  ["Instagram", "socialInstagram"],
  ["YouTube", "socialYoutube"],
];

function OrganizationProfileForm({
  org,
  onSaved,
  onCancel,
}: {
  org: AdminOrganizationDetail;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [, field] of PROFILE_TEXT_FIELDS) initial[field] = (org[field] as string | null) ?? "";
    initial.description = org.description ?? "";
    initial.contentMarkdown = org.contentMarkdown ?? "";
    return initial;
  });
  const [membershipCategory, setMembershipCategory] = useState<string>(
    org.membershipCategory ?? ORG_TIED_MEMBERSHIP_CATEGORIES[0],
  );
  const [memberSince, setMemberSince] = useState(org.memberSince.slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body: Record<string, string | null> = { membershipCategory, memberSince: memberSince || null };
      for (const [, field] of PROFILE_TEXT_FIELDS) {
        body[field] = form[field].trim() ? form[field].trim() : null;
      }
      body.description = form.description.trim() ? form.description.trim() : null;
      body.contentMarkdown = form.contentMarkdown.trim() ? form.contentMarkdown.trim() : null;

      await api(`/api/v1/admin/organizations/${org.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast("Organization updated", "success");
      onSaved();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div class="row g-2 mb-2">
        <div class="col-md-4">
          <label class="form-label small mb-1">Membership category</label>
          <select
            class="form-select form-select-sm"
            value={membershipCategory}
            onChange={(e) => setMembershipCategory((e.target as HTMLSelectElement).value)}
            disabled={saving}
          >
            {ORG_TIED_MEMBERSHIP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div class="form-text">Changing this updates every representative's category to match.</div>
        </div>
        <div class="col-md-4">
          <label class="form-label small mb-1">Member since</label>
          <input
            type="date"
            class="form-control form-control-sm"
            value={memberSince}
            onInput={(e) => setMemberSince((e.target as HTMLInputElement).value)}
            disabled={saving}
          />
        </div>
        {PROFILE_TEXT_FIELDS.map(([label, field]) => (
          <div key={field} class="col-md-4">
            <label class="form-label small mb-1">{label}</label>
            <input
              type="text"
              class="form-control form-control-sm"
              value={form[field]}
              onInput={(e) => setForm((f) => ({ ...f, [field]: (e.target as HTMLInputElement).value }))}
              disabled={saving}
            />
          </div>
        ))}
        <div class="col-12">
          <label class="form-label small mb-1">Description</label>
          <textarea
            class="form-control form-control-sm"
            rows={2}
            value={form.description}
            onInput={(e) => setForm((f) => ({ ...f, description: (e.target as HTMLTextAreaElement).value }))}
            disabled={saving}
          />
        </div>
        <div class="col-12">
          <label class="form-label small mb-1">Content (Markdown)</label>
          <textarea
            class="form-control form-control-sm mono"
            rows={8}
            value={form.contentMarkdown}
            onInput={(e) => setForm((f) => ({ ...f, contentMarkdown: (e.target as HTMLTextAreaElement).value }))}
            disabled={saving}
          />
        </div>
      </div>
      {error && <div class="alert alert-danger small py-2 mb-2">{error}</div>}
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button class="btn btn-sm btn-outline-secondary" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────────────
// Logo manager
// ────────────────────────────────────────────────────────

function OrganizationLogo({ org, onChanged }: { org: AdminOrganizationDetail; onChanged: () => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/organizations/${org.id}/logo`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      toast("Logo uploaded", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function remove() {
    if (!confirm("Remove this organization's logo?")) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/organizations/${org.id}/logo`, { method: "DELETE" });
      toast("Logo removed", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="text-center">
      {org.logoUrl ? (
        <img
          src={org.logoUrl}
          alt={`${org.name} logo`}
          class="img-fluid mb-2 border rounded p-2 bg-white"
          style="max-height: 160px;"
        />
      ) : (
        <div
          class="d-flex align-items-center justify-content-center mb-2 border rounded bg-light text-muted"
          style="height: 120px;"
        >
          No logo
        </div>
      )}
      <div class="d-flex gap-2 justify-content-center">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="form-control form-control-sm w-auto"
          disabled={busy}
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) void upload(file);
          }}
        />
        {org.logoUrl && (
          <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={remove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Organization detail view
// ────────────────────────────────────────────────────────

function OrganizationDetailView({ organizationId, onBack }: { organizationId: string; onBack: () => void }) {
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

// ────────────────────────────────────────────────────────
// Organization list
// ────────────────────────────────────────────────────────

export function Organizations() {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const tableRef = useRef<ApiTableActions | null>(null);

  if (selectedOrgId) {
    return <OrganizationDetailView organizationId={selectedOrgId} onBack={() => setSelectedOrgId(null)} />;
  }

  return (
    <div>
      <div class="mb-3">
        <button class="btn btn-sm btn-success" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add organization"}
        </button>
      </div>

      {showAddForm && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white fw-semibold">Add organization or individual member</div>
          <div class="card-body">
            <AddOrganizationForm
              onCreated={() => {
                setShowAddForm(false);
                tableRef.current?.reload();
              }}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        </div>
      )}

      <ApiDataTable<AdminOrganizationSummary>
        endpoint="/api/v1/admin/organizations"
        resolve={(d) => (d as { organizations: AdminOrganizationSummary[] }).organizations}
        resolvePage={(d) => (d as { page: { total: number; hasMore: boolean } }).page}
        paginate
        actionsRef={tableRef}
        searchPlaceholder="organization name"
        columns={[
          {
            header: "Name",
            cell: (o) => (
              <>
                <strong class="adm-cell-name">{o.name}</strong>
                {o.slogan && (
                  <>
                    <br />
                    <span class="text-muted small">{o.slogan}</span>
                  </>
                )}
              </>
            ),
          },
          {
            header: "Primary contact",
            cell: (o) =>
              o.primaryContactName ? (
                <>
                  {o.primaryContactName}
                  <br />
                  <span class="mono text-muted small">{o.primaryContactEmail}</span>
                </>
              ) : (
                <span class="text-muted fst-italic">None</span>
              ),
          },
          { header: "Representatives", cell: (o) => o.memberCount, className: "text-center" },
          {
            header: "Website",
            cell: (o) =>
              o.website ? (
                <a href={o.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  {o.website.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                "—"
              ),
            className: "small",
          },
          { header: "Created", cell: (o) => fmt(o.createdAt), className: "mono small text-nowrap" },
        ]}
        empty="No organizations found"
        rowKey={(o) => o.id}
        rowClass={() => "adm-user-row"}
        onRowClick={(o) => setSelectedOrgId(o.id)}
      />
    </div>
  );
}
