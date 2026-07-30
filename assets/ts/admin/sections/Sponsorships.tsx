/**
 * Admin → Sponsorships (PRD §4.13, Phase 4E). Sales pipeline: filterable
 * list, detail panel with stage-advance control + editable
 * tier/assigned-staff/renewal-date/notes, and the full audit trail
 * (sponsorship_events). Staff-only — members never see pipeline stage,
 * only their org's active tier (My Organization, not built here).
 */
import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { api } from "../api";
import { toast, fmt } from "../ui";
import { SPONSORSHIP_PIPELINE_STAGES } from "../types";
import type { Sponsorship, SponsorshipEvent, SponsorshipPipelineStage } from "../types";

const SPONSOR_TYPES = ["consortium", "event"] as const;

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

interface CompanyGroup {
  key: string;
  label: string;
  website: string | null;
  sponsorships: Sponsorship[];
}

/**
 * Groups the flat sponsorship list by "company" — the member organization
 * when one is attached, otherwise the non-member sponsor's name (event
 * sponsors are frequently not PKIC members). Sponsorships with neither
 * (shouldn't normally happen, but the schema allows it) fall back to the
 * contact name, then a per-row "Unspecified sponsor" bucket so nothing is
 * silently dropped from the list.
 */
function companyKey(s: Sponsorship): string {
  if (s.organizationId) return `org:${s.organizationId}`;
  if (s.nonMemberName) return `nonmember:${s.nonMemberName}`;
  if (s.contactName) return `contact:${s.contactName}`;
  return `sponsorship:${s.id}`;
}

function companyLabel(s: Sponsorship): string {
  return s.organizationName ?? s.nonMemberName ?? s.contactName ?? "Unspecified sponsor";
}

function groupByCompany(sponsorships: Sponsorship[]): CompanyGroup[] {
  const groups = new Map<string, CompanyGroup>();
  for (const s of sponsorships) {
    const key = companyKey(s);
    const existing = groups.get(key);
    if (existing) {
      existing.sponsorships.push(s);
    } else {
      groups.set(key, { key, label: companyLabel(s), website: s.nonMemberWebsite, sponsorships: [s] });
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * 2026-07-30 testing feedback: the flat list mixed every sponsor of every
 * type/stage in one scroll, so finding "what does company X sponsor" meant
 * scanning the whole list for name matches. This drills down instead:
 * companies → that company's sponsorships → sponsorship detail.
 */
export function Sponsorships() {
  const [type, setType] = useState<"" | (typeof SPONSOR_TYPES)[number]>("");
  const [stage, setStage] = useState<"" | SponsorshipPipelineStage>("");
  const [sponsorships, setSponsorships] = useState<Sponsorship[]>([]);
  const [selectedCompanyKey, setSelectedCompanyKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (stage) params.set("stage", stage);
      params.set("limit", "200");
      const data = await api<{ sponsorships: Sponsorship[] }>(`/api/v1/admin/sponsorships?${params.toString()}`);
      setSponsorships(data.sponsorships);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [type, stage]);

  useEffect(() => {
    void load();
  }, [load]);

  const companies = groupByCompany(sponsorships);
  const selectedCompany = companies.find((c) => c.key === selectedCompanyKey) ?? null;

  // If filters change out from under the current selection (or the company
  // has no sponsorships left matching the filter), fall back a level rather
  // than showing a stale/empty panel.
  useEffect(() => {
    if (selectedCompanyKey && !selectedCompany) {
      setSelectedCompanyKey(null);
      setSelectedId(null);
    }
  }, [selectedCompanyKey, selectedCompany]);

  useEffect(() => {
    if (selectedId && selectedCompany && !selectedCompany.sponsorships.some((s) => s.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, selectedCompany]);

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
            void load();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading && <Spinner />}
      {error && <ErrorAlert error={error} />}
      {!loading && !error && companies.length === 0 && <p class="text-muted">No sponsorships match these filters.</p>}

      {!loading && !error && companies.length > 0 && !selectedCompany && (
        <div class="list-group">
          {companies.map((c) => {
            const stages = new Set(c.sponsorships.map((s) => s.pipelineStage));
            return (
              <button
                type="button"
                key={c.key}
                class="list-group-item list-group-item-action"
                onClick={() => {
                  setSelectedCompanyKey(c.key);
                  setSelectedId(c.sponsorships.length === 1 ? c.sponsorships[0].id : null);
                }}
              >
                <div class="d-flex justify-content-between align-items-center">
                  <span class="fw-semibold">{c.label}</span>
                  <span class="d-flex gap-1">
                    {Array.from(stages).map((s) => (
                      <span key={s} class={`badge text-capitalize ${stageBadgeClass(s)}`}>
                        {stageLabel(s)}
                      </span>
                    ))}
                  </span>
                </div>
                <div class="small text-muted">
                  {c.sponsorships.length} sponsorship{c.sponsorships.length === 1 ? "" : "s"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && !error && selectedCompany && (
        <div>
          <button
            type="button"
            class="btn btn-link btn-sm ps-0 mb-2"
            onClick={() => {
              setSelectedCompanyKey(null);
              setSelectedId(null);
            }}
          >
            ← Back to companies
          </button>
          <h6 class="mb-3">{selectedCompany.label}</h6>
          <div class="row g-3">
            <div class="col-md-5">
              <div class="list-group">
                {selectedCompany.sponsorships.map((s) => (
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
            <div class="col-md-7">{selectedId && <SponsorshipDetail id={selectedId} onChanged={load} />}</div>
          </div>
        </div>
      )}
    </div>
  );
}
