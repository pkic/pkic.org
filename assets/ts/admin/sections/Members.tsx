/**
 * Membership → Members (PRD §6 "Interim Admin Tool — Manual Member
 * Management (pre-Phase 4A)"). Lets staff add a member — or finish one of
 * the §6 Step 2 migration gaps (the ~44 orgs/individuals the YAML→D1
 * migration script couldn't domain-match) — without touching D1 by hand.
 * Backed by `POST/GET /api/v1/admin/members`, gated by `membership:write`.
 */
import { useState, useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../components/Table";
import { Badge } from "../../components/Badge";
import { api } from "../api";
import { toast, fmt } from "../ui";
import type { AdminMemberSummary } from "../types";
import {
  MEMBERSHIP_CATEGORIES,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  WORKING_GROUP_SLUGS,
} from "../../../shared/schemas/admin-members";

// ────────────────────────────────────────────────────────
// New member form
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

function NewMemberForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
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
      toast("Member created", "success");
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
          Create Member
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
// Members list
// ────────────────────────────────────────────────────────

export function Members() {
  const [showNewForm, setShowNewForm] = useState(false);
  const tableRef = useRef<ApiTableActions | null>(null);

  function handleCreated() {
    setShowNewForm(false);
    tableRef.current?.reload();
  }

  return (
    <div>
      <div class="mb-3">
        <button class="btn btn-sm btn-success" onClick={() => setShowNewForm((v) => !v)}>
          {showNewForm ? "Cancel" : "+ Add Member"}
        </button>
      </div>

      {showNewForm && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white fw-semibold">Add member</div>
          <div class="card-body">
            <NewMemberForm onCreated={handleCreated} onCancel={() => setShowNewForm(false)} />
          </div>
        </div>
      )}

      <ApiDataTable<AdminMemberSummary>
        endpoint="/api/v1/admin/members"
        resolve={(d) => (d as { members: AdminMemberSummary[] }).members}
        resolvePage={(d) => (d as { page: { total: number; hasMore: boolean } }).page}
        paginate
        actionsRef={tableRef}
        columns={[
          {
            header: "Name",
            cell: (m) => (
              <>
                <strong class="adm-cell-name">{m.name}</strong>
                <br />
                <span class="mono text-muted small">{m.email}</span>
              </>
            ),
          },
          {
            header: "Organization",
            cell: (m) => m.organizationName ?? <span class="text-muted fst-italic">Individual</span>,
          },
          { header: "Category", cell: (m) => <span class="mono">{m.membershipCategory}</span> },
          { header: "Status", cell: (m) => <Badge status={m.status} /> },
          {
            header: "On org profile",
            cell: (m) => (m.organizationId ? (m.showOnOrgProfile ? "Yes" : "No") : "—"),
            className: "text-center",
          },
          { header: "Since", cell: (m) => fmt(m.createdAt), className: "mono small text-nowrap" },
        ]}
        empty="No members found"
        rowKey={(m) => m.id}
      />
    </div>
  );
}
