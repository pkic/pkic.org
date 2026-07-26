/**
 * Membership → Applications (PRD §4.2). Staff review/transition membership
 * applications through the stage machine, send communications, add
 * internal notes, view uploaded documents, and record EC decisions.
 * List/detail split mirrors Users.tsx; list mirrors Members.tsx's use of
 * ApiDataTable.
 */
import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { ApiDataTable, type ApiTableActions } from "../../components/Table";
import { Badge } from "../../components/Badge";
import { api } from "../api";
import { toast, fmt } from "../ui";
import type { AdminApplicationDetail, AdminApplicationSummary } from "../types";

const STAGE_TRANSITIONS: Record<string, string[]> = {
  pending: ["in_review", "withdrawn"],
  in_review: ["on_hold", "in_consultation", "declined", "withdrawn"],
  on_hold: ["in_review", "withdrawn"],
  in_consultation: ["ec_review", "withdrawn"],
  ec_review: ["declined", "withdrawn"],
  approved: [],
  declined: [],
  withdrawn: [],
};

const ON_HOLD_SUBTYPES = [
  "request_authority",
  "request_org_email",
  "request_pki_experience",
  "request_org_application",
  "request_information",
];

// ────────────────────────────────────────────────────────
// Detail view
// ────────────────────────────────────────────────────────

function ApplicationDetailView({ applicationId, onBack }: { applicationId: string; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminApplicationDetail | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [toStage, setToStage] = useState("");
  const [onHoldSubtype, setOnHoldSubtype] = useState(ON_HOLD_SUBTYPES[0]);
  const [transitionNote, setTransitionNote] = useState("");
  const [commSubject, setCommSubject] = useState("");
  const [commBody, setCommBody] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [ecMemberUserId, setEcMemberUserId] = useState("");
  const [ecDecision, setEcDecision] = useState<"approve" | "decline">("approve");
  const [ecReason, setEcReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<AdminApplicationDetail>(`/api/v1/admin/applications/${applicationId}`);
      setDetail(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitTransition(e: Event) {
    e.preventDefault();
    if (!toStage) return;
    setTransitioning(true);
    try {
      await api(`/api/v1/admin/applications/${applicationId}/stage`, {
        method: "PATCH",
        body: JSON.stringify({
          toStage,
          onHoldSubtype: toStage === "on_hold" ? onHoldSubtype : undefined,
          note: transitionNote || undefined,
        }),
      });
      toast(`Application moved to '${toStage}'`, "success");
      setToStage("");
      setTransitionNote("");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setTransitioning(false);
    }
  }

  async function submitCommunication(e: Event) {
    e.preventDefault();
    if (!commSubject.trim() || !commBody.trim()) return;
    try {
      await api(`/api/v1/admin/applications/${applicationId}/communications`, {
        method: "POST",
        body: JSON.stringify({ subject: commSubject, body: commBody }),
      });
      toast("Communication sent", "success");
      setCommSubject("");
      setCommBody("");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function submitNote(e: Event) {
    e.preventDefault();
    if (!noteBody.trim()) return;
    try {
      await api(`/api/v1/admin/applications/${applicationId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: noteBody }),
      });
      toast("Note added", "success");
      setNoteBody("");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function submitEcDecision(e: Event) {
    e.preventDefault();
    if (!ecMemberUserId.trim()) return;
    try {
      await api(`/api/v1/admin/applications/${applicationId}/ec-decisions`, {
        method: "POST",
        body: JSON.stringify({ ecMemberUserId, decision: ecDecision, reason: ecReason || undefined }),
      });
      toast("EC decision recorded", "success");
      setEcMemberUserId("");
      setEcReason("");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function approve() {
    if (!confirm("Approve this application and run onboarding?")) return;
    try {
      await api(`/api/v1/admin/applications/${applicationId}/approve`, { method: "POST" });
      toast("Application approved", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!detail) return null;

  const availableTransitions = STAGE_TRANSITIONS[detail.stage] ?? [];

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={onBack}>
          ← Back to list
        </button>
        <span class="page-heading mb-0">{detail.applicantName}</span>
        <Badge status={detail.stage} />
      </div>

      <div class="row g-4">
        <div class="col-md-6">
          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white fw-semibold">Application</div>
            <div class="card-body">
              <table class="table table-sm table-borderless mb-0">
                <tbody>
                  <tr>
                    <th class="text-muted small">Email</th>
                    <td>{detail.applicantEmail}</td>
                  </tr>
                  <tr>
                    <th class="text-muted small">Organization</th>
                    <td>{detail.organizationName ?? <span class="fst-italic text-muted">Individual</span>}</td>
                  </tr>
                  <tr>
                    <th class="text-muted small">Category</th>
                    <td class="mono">{detail.membershipCategory}</td>
                  </tr>
                  <tr>
                    <th class="text-muted small">Status</th>
                    <td>
                      <Badge status={detail.status} />
                    </td>
                  </tr>
                  {detail.onHoldSubtype && (
                    <tr>
                      <th class="text-muted small">On-hold reason</th>
                      <td>{detail.onHoldSubtype}</td>
                    </tr>
                  )}
                  <tr>
                    <th class="text-muted small">Stage entered</th>
                    <td class="mono small">{fmt(detail.stageEnteredAt)}</td>
                  </tr>
                  <tr>
                    <th class="text-muted small">Submitted</th>
                    <td class="mono small">{fmt(detail.createdAt)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white fw-semibold">Stage transition</div>
            <div class="card-body">
              {detail.stage === "ec_review" && (
                <button class="btn btn-sm btn-success mb-3" onClick={approve}>
                  Approve &amp; run onboarding
                </button>
              )}
              {availableTransitions.length === 0 ? (
                <p class="text-muted small mb-0">No further transitions from this stage.</p>
              ) : (
                <form onSubmit={submitTransition}>
                  <div class="row g-2 align-items-end">
                    <div class="col-auto">
                      <label class="form-label small mb-1">Move to</label>
                      <select
                        class="form-select form-select-sm"
                        value={toStage}
                        onChange={(e) => setToStage((e.target as HTMLSelectElement).value)}
                      >
                        <option value="">Select…</option>
                        {availableTransitions.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    {toStage === "on_hold" && (
                      <div class="col-auto">
                        <label class="form-label small mb-1">Reason</label>
                        <select
                          class="form-select form-select-sm"
                          value={onHoldSubtype}
                          onChange={(e) => setOnHoldSubtype((e.target as HTMLSelectElement).value)}
                        >
                          {ON_HOLD_SUBTYPES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div class="col">
                      <label class="form-label small mb-1">Note (optional)</label>
                      <input
                        class="form-control form-control-sm"
                        value={transitionNote}
                        onInput={(e) => setTransitionNote((e.target as HTMLInputElement).value)}
                      />
                    </div>
                    <div class="col-auto">
                      <button type="submit" class="btn btn-sm btn-primary" disabled={!toStage || transitioning}>
                        Transition
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>

          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white fw-semibold">Documents</div>
            <div class="card-body">
              {detail.documents.length === 0 ? (
                <p class="text-muted small mb-0">No documents uploaded.</p>
              ) : (
                <ul class="list-unstyled mb-0 small">
                  {detail.documents.map((d) => (
                    <li key={d.id}>
                      {d.filename}{" "}
                      <span class="text-muted">
                        ({Math.round(d.fileSizeBytes / 1024)} KB, {fmt(d.uploadedAt)})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div class="col-md-6">
          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white fw-semibold">Timeline</div>
            <div class="card-body">
              <ul class="list-unstyled mb-0 small">
                {detail.events.map((ev, i) => (
                  <li key={i} class="mb-1">
                    <span class="mono text-muted">{fmt(ev.createdAt)}</span> — {ev.fromStage ?? "…"} → {ev.toStage}
                    {ev.note && <span class="text-muted"> ({ev.note})</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white fw-semibold">Communications &amp; notes</div>
            <div class="card-body">
              <ul class="list-unstyled small mb-3">
                {[...detail.communications].map((c) => (
                  <li key={c.id} class="mb-2 pb-2 border-bottom">
                    <span class="badge text-bg-secondary me-1">{c.kind}</span>
                    {c.subject && <strong>{c.subject}</strong>}
                    <div class="text-muted">{c.body}</div>
                    <div class="mono text-muted small">{fmt(c.created_at)}</div>
                  </li>
                ))}
                {detail.communications.length === 0 && <li class="text-muted">None yet.</li>}
              </ul>
              <form onSubmit={submitCommunication} class="mb-2">
                <div class="mb-1 fw-semibold small">Send communication</div>
                <input
                  class="form-control form-control-sm mb-1"
                  placeholder="Subject"
                  value={commSubject}
                  onInput={(e) => setCommSubject((e.target as HTMLInputElement).value)}
                />
                <textarea
                  class="form-control form-control-sm mb-1"
                  rows={2}
                  placeholder="Message"
                  value={commBody}
                  onInput={(e) => setCommBody((e.target as HTMLTextAreaElement).value)}
                />
                <button type="submit" class="btn btn-sm btn-outline-primary">
                  Send
                </button>
              </form>
              <form onSubmit={submitNote}>
                <div class="mb-1 fw-semibold small">Add internal note</div>
                <textarea
                  class="form-control form-control-sm mb-1"
                  rows={2}
                  placeholder="Note (never emailed)"
                  value={noteBody}
                  onInput={(e) => setNoteBody((e.target as HTMLTextAreaElement).value)}
                />
                <button type="submit" class="btn btn-sm btn-outline-secondary">
                  Add note
                </button>
              </form>
            </div>
          </div>

          <div class="card border-0 shadow-sm mb-3">
            <div class="card-header bg-white fw-semibold">EC decisions</div>
            <div class="card-body">
              <ul class="list-unstyled small mb-3">
                {detail.ecDecisions.map((d) => (
                  <li key={d.id} class="mb-1">
                    <Badge status={d.decision} /> {d.reason && <span class="text-muted">— {d.reason}</span>}
                  </li>
                ))}
                {detail.ecDecisions.length === 0 && <li class="text-muted">None recorded.</li>}
              </ul>
              <form onSubmit={submitEcDecision}>
                <div class="mb-1 fw-semibold small">Record on behalf of an EC member (staff override)</div>
                <input
                  class="form-control form-control-sm mb-1"
                  placeholder="EC member user id"
                  value={ecMemberUserId}
                  onInput={(e) => setEcMemberUserId((e.target as HTMLInputElement).value)}
                />
                <div class="d-flex gap-2 mb-1">
                  <select
                    class="form-select form-select-sm w-auto"
                    value={ecDecision}
                    onChange={(e) => setEcDecision((e.target as HTMLSelectElement).value as "approve" | "decline")}
                  >
                    <option value="approve">approve</option>
                    <option value="decline">decline</option>
                  </select>
                  <input
                    class="form-control form-control-sm"
                    placeholder="Reason (required for decline)"
                    value={ecReason}
                    onInput={(e) => setEcReason((e.target as HTMLInputElement).value)}
                  />
                </div>
                <button type="submit" class="btn btn-sm btn-outline-primary">
                  Record
                </button>
              </form>
            </div>
          </div>

          <div class="card border-0 shadow-sm">
            <div class="card-header bg-white fw-semibold">Consultation concerns</div>
            <div class="card-body">
              <ul class="list-unstyled small mb-0">
                {detail.concerns.map((c) => (
                  <li key={c.id} class="mb-2">
                    {c.concern_text}
                    <div class="mono text-muted small">{fmt(c.created_at)}</div>
                  </li>
                ))}
                {detail.concerns.length === 0 && <li class="text-muted">None submitted.</li>}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// List view
// ────────────────────────────────────────────────────────

function ApplicationsList({ onViewApplication }: { onViewApplication: (id: string) => void }) {
  const [stageFilter, setStageFilter] = useState("");
  const tableRef = useRef<ApiTableActions | null>(null);

  return (
    <ApiDataTable<AdminApplicationSummary>
      endpoint="/api/v1/admin/applications"
      resolve={(d) => (d as { applications: AdminApplicationSummary[] }).applications}
      resolvePage={(d) => (d as { page: { total: number; hasMore: boolean } }).page}
      paginate
      actionsRef={tableRef}
      searchPlaceholder="applicant email or name"
      params={stageFilter ? { stage: stageFilter } : {}}
      deps={[stageFilter]}
      toolbar={({ resetPage }) => (
        <select
          class="form-select form-select-sm w-auto"
          value={stageFilter}
          onChange={(e) => {
            setStageFilter((e.target as HTMLSelectElement).value);
            resetPage();
          }}
        >
          <option value="">All stages</option>
          {Object.keys(STAGE_TRANSITIONS).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
      columns={[
        {
          header: "Applicant",
          cell: (a) => (
            <>
              <strong class="adm-cell-name">{a.applicantName}</strong>
              <br />
              <span class="mono text-muted small">{a.applicantEmail}</span>
            </>
          ),
        },
        {
          header: "Organization",
          cell: (a) => a.organizationName ?? <span class="text-muted fst-italic">Individual</span>,
        },
        { header: "Category", cell: (a) => <span class="mono">{a.membershipCategory}</span> },
        { header: "Stage", cell: (a) => <Badge status={a.stage} /> },
        { header: "Submitted", cell: (a) => fmt(a.createdAt), className: "mono small text-nowrap" },
      ]}
      empty="No applications found"
      rowKey={(a) => a.id}
      onRowClick={(a) => onViewApplication(a.id)}
    />
  );
}

// ────────────────────────────────────────────────────────
// Main section
// ────────────────────────────────────────────────────────

export function Applications() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    return <ApplicationDetailView applicationId={selectedId} onBack={() => setSelectedId(null)} />;
  }
  return <ApplicationsList onViewApplication={(id) => setSelectedId(id)} />;
}
