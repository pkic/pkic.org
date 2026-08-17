/**
 * Admin → Sponsorships. Sales pipeline: filterable
 * list, detail panel with stage-advance control + editable
 * tier/assigned-staff/renewal-date/notes, and the full audit trail
 * (sponsorship_events). Staff-only — members never see pipeline stage,
 * only their org's active tier (My Organization, not built here).
 */
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { ApiDataTable, type ApiTableActions, type Column } from "../../components/Table";
import { api } from "../api";
import { toast, fmt } from "../ui";
import { SPONSORSHIP_PIPELINE_STAGES } from "../types";
import { SPONSOR_TYPES } from "../../../shared/schemas/admin-sponsorships";
import type { Sponsorship, SponsorshipCompany, SponsorshipEvent, SponsorshipPipelineStage } from "../types";

function stageBadgeClass(stage: SponsorshipPipelineStage): string {
  if (stage === "active") return "text-bg-success";
  if (stage === "lapsed") return "text-bg-secondary";
  if (stage === "payment_pending") return "text-bg-warning";
  return "text-bg-light";
}

function stageLabel(stage: string): string {
  return stage.replace(/_/g, " ");
}

interface CreateDraft {
  sponsorType: (typeof SPONSOR_TYPES)[number];
  organizationId: string;
  eventId: string;
  nonMemberName: string;
  contactName: string;
  contactEmail: string;
  tier: string;
}

function emptyCreateDraft(): CreateDraft {
  return {
    sponsorType: "consortium",
    organizationId: "",
    eventId: "",
    nonMemberName: "",
    contactName: "",
    contactEmail: "",
    tier: "",
  };
}

function CreateSponsorshipForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<CreateDraft>(emptyCreateDraft());
  const [saving, setSaving] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/v1/admin/sponsorships", {
        method: "POST",
        body: JSON.stringify({
          sponsorType: draft.sponsorType,
          organizationId: draft.organizationId.trim() || null,
          eventId: draft.eventId.trim() || null,
          nonMemberName: draft.nonMemberName.trim() || null,
          contactName: draft.contactName.trim() || null,
          contactEmail: draft.contactEmail.trim() || null,
          tier: draft.tier.trim() || null,
        }),
      });
      toast("Sponsorship created", "success");
      onCreated();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <div class="row g-2">
          <div class="col-sm-2">
            <label class="form-label small">Type</label>
            <select
              class="form-select form-select-sm"
              value={draft.sponsorType}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  sponsorType: (e.target as HTMLSelectElement).value as CreateDraft["sponsorType"],
                }))
              }
            >
              {SPONSOR_TYPES.map((t) => (
                <option value={t} key={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {draft.sponsorType === "consortium" ? (
            <div class="col-sm-3">
              <label class="form-label small">Organization ID</label>
              <input
                class="form-control form-control-sm"
                value={draft.organizationId}
                onInput={(e) => setDraft((d) => ({ ...d, organizationId: (e.target as HTMLInputElement).value }))}
                required
              />
            </div>
          ) : (
            <>
              <div class="col-sm-3">
                <label class="form-label small">Event ID</label>
                <input
                  class="form-control form-control-sm"
                  value={draft.eventId}
                  onInput={(e) => setDraft((d) => ({ ...d, eventId: (e.target as HTMLInputElement).value }))}
                />
              </div>
              <div class="col-sm-2">
                <label class="form-label small">Non-member name</label>
                <input
                  class="form-control form-control-sm"
                  value={draft.nonMemberName}
                  onInput={(e) => setDraft((d) => ({ ...d, nonMemberName: (e.target as HTMLInputElement).value }))}
                />
              </div>
            </>
          )}
          <div class="col-sm-2">
            <label class="form-label small">Tier</label>
            <input
              class="form-control form-control-sm"
              value={draft.tier}
              onInput={(e) => setDraft((d) => ({ ...d, tier: (e.target as HTMLInputElement).value }))}
            />
          </div>
          <div class="col-sm-2">
            <label class="form-label small">Contact name</label>
            <input
              class="form-control form-control-sm"
              value={draft.contactName}
              onInput={(e) => setDraft((d) => ({ ...d, contactName: (e.target as HTMLInputElement).value }))}
            />
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Contact email</label>
            <input
              type="email"
              class="form-control form-control-sm"
              value={draft.contactEmail}
              onInput={(e) => setDraft((d) => ({ ...d, contactEmail: (e.target as HTMLInputElement).value }))}
            />
          </div>
        </div>
        <div class="mt-2 d-flex gap-2">
          <button type="submit" class="btn btn-success btn-sm" disabled={saving}>
            Create
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Logo manager for non-member sponsors only (organizationId null) — mirrors
 * Organizations.tsx's OrganizationLogo. Org-tied sponsors show/manage their
 * logo via the organization itself, since that's what the public sponsor
 * list actually reads (organizations.logo_r2_key, GET /api/v1/members/:id/logo).
 */
function SponsorshipLogo({ sponsorship, onChanged }: { sponsorship: Sponsorship; onChanged: () => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/sponsorships/${sponsorship.id}/logo`, {
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
    if (!confirm("Remove this sponsor's logo?")) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/sponsorships/${sponsorship.id}/logo`, { method: "DELETE" });
      toast("Logo removed", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="d-flex align-items-center gap-3 mb-3">
      {sponsorship.nonMemberLogoUrl ? (
        <img
          src={sponsorship.nonMemberLogoUrl}
          alt={`${sponsorship.nonMemberName ?? "Sponsor"} logo`}
          class="border rounded p-1 bg-white"
          style="max-height: 60px; max-width: 120px;"
        />
      ) : (
        <div
          class="d-flex align-items-center justify-content-center border rounded bg-light text-muted small"
          style="height: 60px; width: 120px;"
        >
          No logo
        </div>
      )}
      <div class="d-flex flex-column gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="form-control form-control-sm"
          disabled={busy}
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) void upload(file);
          }}
        />
        {sponsorship.nonMemberLogoUrl && (
          <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={remove}>
            Remove logo
          </button>
        )}
      </div>
    </div>
  );
}

function SponsorshipDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [sponsorship, setSponsorship] = useState<Sponsorship | null>(null);
  const [events, setEvents] = useState<SponsorshipEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [nextStage, setNextStage] = useState<SponsorshipPipelineStage>("contacted");
  const [stageNote, setStageNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detailData, eventsData] = await Promise.all([
        api<{ sponsorship: Sponsorship }>(`/api/v1/admin/sponsorships/${id}`),
        api<{ events: SponsorshipEvent[] }>(`/api/v1/admin/sponsorships/${id}/events`),
      ]);
      setSponsorship(detailData.sponsorship);
      setEvents(eventsData.events);
      setNotes(detailData.sponsorship.notes ?? "");
      setRenewalDate(detailData.sponsorship.renewalDate ?? "");
      setAssignedToUserId(detailData.sponsorship.assignedToUserId ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveFields() {
    setBusy(true);
    try {
      await api(`/api/v1/admin/sponsorships/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          notes: notes.trim() || null,
          renewalDate: renewalDate.trim() || null,
          assignedToUserId: assignedToUserId.trim() || null,
        }),
      });
      toast("Saved", "success");
      await load();
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function advanceStage() {
    setBusy(true);
    try {
      await api(`/api/v1/admin/sponsorships/${id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ toStage: nextStage, note: stageNote.trim() || null }),
      });
      toast(`Stage advanced to ${stageLabel(nextStage)}`, "success");
      setStageNote("");
      await load();
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!sponsorship) return null;

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <div>
            <h6 class="mb-1">
              {sponsorship.organizationName ?? sponsorship.nonMemberName ?? sponsorship.contactName ?? "Sponsor"}
            </h6>
            <p class="text-muted small mb-0">
              {sponsorship.sponsorType} · {sponsorship.tier ?? "no tier"}
              {sponsorship.eventName && <> · {sponsorship.eventName}</>}
            </p>
          </div>
          <span class={`badge text-capitalize ${stageBadgeClass(sponsorship.pipelineStage)}`}>
            {stageLabel(sponsorship.pipelineStage)}
          </span>
        </div>

        {sponsorship.contactEmail && (
          <p class="small mb-3">
            Contact: {sponsorship.contactName ?? sponsorship.contactEmail} &lt;{sponsorship.contactEmail}&gt;
          </p>
        )}

        {!sponsorship.organizationId && <SponsorshipLogo sponsorship={sponsorship} onChanged={load} />}

        <div class="row g-2 mb-3">
          <div class="col-sm-4">
            <label class="form-label small">Assigned staff user ID</label>
            <input
              class="form-control form-control-sm"
              value={assignedToUserId}
              onInput={(e) => setAssignedToUserId((e.target as HTMLInputElement).value)}
            />
            {sponsorship.assignedToName && <div class="form-text">{sponsorship.assignedToName}</div>}
          </div>
          <div class="col-sm-3">
            <label class="form-label small">Renewal date</label>
            <input
              type="date"
              class="form-control form-control-sm"
              value={renewalDate}
              onInput={(e) => setRenewalDate((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="col-sm-5">
            <label class="form-label small">Notes</label>
            <input
              class="form-control form-control-sm"
              value={notes}
              onInput={(e) => setNotes((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <button type="button" class="btn btn-outline-primary btn-sm mb-3" disabled={busy} onClick={saveFields}>
          Save fields
        </button>

        <hr />

        <div class="row g-2 align-items-end mb-3">
          <div class="col-sm-4">
            <label class="form-label small">Advance to stage</label>
            <select
              class="form-select form-select-sm"
              value={nextStage}
              onChange={(e) => setNextStage((e.target as HTMLSelectElement).value as SponsorshipPipelineStage)}
            >
              {SPONSORSHIP_PIPELINE_STAGES.map((s) => (
                <option value={s} key={s}>
                  {stageLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div class="col-sm-5">
            <label class="form-label small">Note (optional)</label>
            <input
              class="form-control form-control-sm"
              value={stageNote}
              onInput={(e) => setStageNote((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="col-sm-3">
            <button type="button" class="btn btn-primary btn-sm w-100" disabled={busy} onClick={advanceStage}>
              Advance
            </button>
          </div>
        </div>

        <h6 class="small text-uppercase text-muted mb-2">Pipeline history</h6>
        <ul class="list-unstyled small mb-0">
          {events.map((ev) => (
            <li key={ev.id} class="mb-1">
              <span class="text-muted">{fmt(ev.createdAt)}</span> —{" "}
              {ev.fromStage ? `${stageLabel(ev.fromStage)} → ` : ""}
              <strong>{stageLabel(ev.toStage)}</strong>
              {ev.actorName && <span class="text-muted"> by {ev.actorName}</span>}
              {ev.note && <div class="text-muted fst-italic">{ev.note}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Decomposes a company list row's `key` (built server-side in
 * `listSponsorshipCompanies`) back into the filter the detail panel needs
 * to fetch that company's sponsorships — organization/non-member-name/
 * contact-name, matching the same fallback order the grouping query uses.
 */
function companyDetailParams(key: string): Record<string, string> {
  if (key.startsWith("org:")) return { organizationId: key.slice("org:".length) };
  if (key.startsWith("nonmember:")) return { nonMemberName: key.slice("nonmember:".length) };
  if (key.startsWith("contact:")) return { contactName: key.slice("contact:".length) };
  return {};
}

/**
 * 2026-07-30 testing feedback: the flat list mixed every sponsor of every
 * type/stage in one scroll, so finding "what does company X sponsor" meant
 * scanning the whole list for name matches. This drills down instead:
 * companies → that company's sponsorships → sponsorship detail. Company
 * grouping/sorting/pagination happens in D1 via `/companies`
 * (`listSponsorshipCompanies`), not by fetching every matching sponsorship
 * into the browser to group client-side (PR #1 review) — the detail panel
 * then fetches only the selected company's (naturally bounded) rows.
 */
export function Sponsorships() {
  const [type, setType] = useState<"" | (typeof SPONSOR_TYPES)[number]>("");
  const [stage, setStage] = useState<"" | SponsorshipPipelineStage>("");
  const [selectedCompany, setSelectedCompany] = useState<SponsorshipCompany | null>(null);
  const [companySponsorships, setCompanySponsorships] = useState<Sponsorship[]>([]);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const tableRef = useRef<ApiTableActions | null>(null);

  const loadCompanySponsorships = useCallback(
    async (company: SponsorshipCompany) => {
      setCompanyLoading(true);
      setCompanyError(null);
      try {
        if (company.key.startsWith("sponsorship:")) {
          const id = company.key.slice("sponsorship:".length);
          const data = await api<{ sponsorship: Sponsorship }>(`/api/v1/admin/sponsorships/${id}`);
          setCompanySponsorships([data.sponsorship]);
          setSelectedId(data.sponsorship.id);
          return;
        }
        const params = new URLSearchParams({ ...companyDetailParams(company.key), limit: "200", offset: "0" });
        if (type) params.set("type", type);
        if (stage) params.set("stage", stage);
        const data = await api<{ sponsorships: Sponsorship[] }>(`/api/v1/admin/sponsorships?${params.toString()}`);
        setCompanySponsorships(data.sponsorships);
        setSelectedId((prev) => {
          if (prev && data.sponsorships.some((s) => s.id === prev)) return prev;
          return data.sponsorships.length === 1 ? data.sponsorships[0].id : null;
        });
      } catch (e) {
        setCompanyError((e as Error).message);
      } finally {
        setCompanyLoading(false);
      }
    },
    [type, stage],
  );

  function selectCompany(company: SponsorshipCompany) {
    setSelectedCompany(company);
    void loadCompanySponsorships(company);
  }

  function backToCompanies() {
    setSelectedCompany(null);
    setCompanySponsorships([]);
    setSelectedId(null);
  }

  // Filters apply to the currently-open company too, not just the list.
  // Deliberately keyed on [type, stage] only, not selectedCompany — this
  // should refetch when filters change, not every time a new company is
  // selected (selectCompany already triggers that fetch itself).
  useEffect(() => {
    if (selectedCompany) void loadCompanySponsorships(selectedCompany);
  }, [type, stage]);

  function reloadAll() {
    tableRef.current?.reload();
    if (selectedCompany) void loadCompanySponsorships(selectedCompany);
  }

  const companyColumns: Column<SponsorshipCompany>[] = [
    { header: "Company", cell: (c) => <span class="fw-semibold">{c.label}</span> },
    {
      header: "Stages",
      cell: (c) => (
        <span class="d-flex gap-1 flex-wrap">
          {c.stages.split(",").map((s) => (
            <span key={s} class={`badge text-capitalize ${stageBadgeClass(s as SponsorshipPipelineStage)}`}>
              {stageLabel(s)}
            </span>
          ))}
        </span>
      ),
    },
    {
      header: "Sponsorships",
      cell: (c) => `${c.sponsorshipCount} sponsorship${c.sponsorshipCount === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div>
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center mb-3">
        <div class="d-flex gap-2">
          <select
            class="form-select form-select-sm"
            value={type}
            onChange={(e) => setType((e.target as HTMLSelectElement).value as typeof type)}
          >
            <option value="">All types</option>
            {SPONSOR_TYPES.map((t) => (
              <option value={t} key={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            class="form-select form-select-sm"
            value={stage}
            onChange={(e) => setStage((e.target as HTMLSelectElement).value as typeof stage)}
          >
            <option value="">All stages</option>
            {SPONSORSHIP_PIPELINE_STAGES.map((s) => (
              <option value={s} key={s}>
                {stageLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" class="btn btn-primary btn-sm" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "Create sponsorship"}
        </button>
      </div>

      {showCreate && (
        <CreateSponsorshipForm
          onCreated={() => {
            setShowCreate(false);
            reloadAll();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {!selectedCompany && (
        <ApiDataTable<SponsorshipCompany>
          endpoint="/api/v1/admin/sponsorships/companies"
          resolve={(d) => (d as { companies: SponsorshipCompany[] }).companies}
          resolvePage={(d) => (d as { page: { total: number; hasMore: boolean } }).page}
          paginate
          actionsRef={tableRef}
          columns={companyColumns}
          params={{ ...(type ? { type } : {}), ...(stage ? { stage } : {}) }}
          deps={[type, stage]}
          rowKey={(c) => c.key}
          onRowClick={selectCompany}
          empty="No sponsorships match these filters."
        />
      )}

      {selectedCompany && (
        <div>
          <button type="button" class="btn btn-link btn-sm ps-0 mb-2" onClick={backToCompanies}>
            ← Back to companies
          </button>
          <h6 class="mb-3">{selectedCompany.label}</h6>
          {companyLoading && <Spinner />}
          {companyError && <ErrorAlert error={companyError} />}
          {!companyLoading && !companyError && (
            <div class="row g-3">
              <div class="col-md-5">
                <div class="list-group">
                  {companySponsorships.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      class={`list-group-item list-group-item-action${selectedId === s.id ? " active" : ""}`}
                      onClick={() => setSelectedId(s.id)}
                    >
                      <div class="d-flex justify-content-between">
                        <span class="fw-semibold">
                          {s.tier ?? "no tier"}
                          {s.eventName && <> — {s.eventName}</>}
                        </span>
                        <span class={`badge text-capitalize ${stageBadgeClass(s.pipelineStage)}`}>
                          {stageLabel(s.pipelineStage)}
                        </span>
                      </div>
                      <div class="small text-muted">{s.sponsorType}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div class="col-md-7">{selectedId && <SponsorshipDetail id={selectedId} onChanged={reloadAll} />}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
