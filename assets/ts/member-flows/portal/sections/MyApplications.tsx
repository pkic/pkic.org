/**
 * My Application — View original application, status history,
 * and timeline. Most members have exactly one application, but the backend
 * (GET /api/v1/me/applications) returns every application matching the
 * caller's email, so this renders as a list that expands into a detail view
 * (master/detail within a single tab — no route param, since
 * scoped the nav shell's routing to top-level sections only).
 */
import { useEffect, useState } from "preact/hooks";
import { getJson, ApiClientError } from "../../../shared/api-client";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { fmt, formatStageLabel, stageBadgeClass } from "../ui";
import type { MyApplicationDetail, MyApplicationSummary } from "../types";

function ApplicationDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<MyApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<MyApplicationDetail>(`/api/v1/me/applications/${id}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof ApiClientError ? e.message : "Could not load this application.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div>
      <button class="btn btn-sm btn-outline-secondary mb-3" onClick={onBack}>
        ← Back to applications
      </button>
      {error && <ErrorAlert error={error} />}
      {!detail && !error ? (
        <Spinner />
      ) : (
        detail && (
          <>
            <div class="card border-0 shadow-sm mb-3">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
                  <div>
                    <h3 class="h5 mb-1">{detail.applicantName}</h3>
                    <p class="text-muted small mb-0">
                      {detail.organizationName ?? "Individual applicant"} — Category {detail.membershipCategory}
                    </p>
                  </div>
                  <span class={`badge ${stageBadgeClass(detail.stage)}`}>{formatStageLabel(detail.stage)}</span>
                </div>
                <p class="text-muted small mt-2 mb-0">
                  Submitted {fmt(detail.createdAt)} — last updated {fmt(detail.stageEnteredAt)}
                </p>
              </div>
            </div>

            <div class="card border-0 shadow-sm mb-3">
              <div class="card-header bg-white fw-semibold">Status history</div>
              <ul class="list-group list-group-flush">
                {detail.timeline.map((entry, i) => (
                  <li key={i} class="list-group-item">
                    <div class="d-flex justify-content-between">
                      <span>
                        {entry.fromStage ? `${formatStageLabel(entry.fromStage)} → ` : ""}
                        <strong>{formatStageLabel(entry.toStage)}</strong>
                      </span>
                      <span class="text-muted small">{fmt(entry.createdAt)}</span>
                    </div>
                    {entry.note && <div class="text-muted small mt-1">{entry.note}</div>}
                  </li>
                ))}
              </ul>
            </div>

            {detail.communications.length > 0 && (
              <div class="card border-0 shadow-sm">
                <div class="card-header bg-white fw-semibold">Messages</div>
                <ul class="list-group list-group-flush">
                  {detail.communications.map((entry, i) => (
                    <li key={i} class="list-group-item">
                      <div class="d-flex justify-content-between">
                        <strong>{entry.subject ?? "Message"}</strong>
                        <span class="text-muted small">{fmt(entry.createdAt)}</span>
                      </div>
                      <div class="small mt-1">{entry.body}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}

export function MyApplications() {
  const [applications, setApplications] = useState<MyApplicationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ applications: MyApplicationSummary[] }>("/api/v1/me/applications")
      .then((d) => setApplications(d.applications))
      .catch((e: unknown) => setError(e instanceof ApiClientError ? e.message : "Could not load your applications."));
  }, []);

  if (selectedId) {
    return <ApplicationDetailView id={selectedId} onBack={() => setSelectedId(null)} />;
  }

  if (error) return <ErrorAlert error={error} />;
  if (!applications) return <Spinner />;

  if (applications.length === 0) {
    return <div class="alert alert-info">No membership application is on file for your account.</div>;
  }

  return (
    <div class="card border-0 shadow-sm content-width-md">
      <table class="table table-hover mb-0">
        <thead>
          <tr>
            <th>Category</th>
            <th>Status</th>
            <th>Submitted</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {applications.map((app) => (
            <tr key={app.id} class="is-clickable" onClick={() => setSelectedId(app.id)}>
              <td>{app.membershipCategory}</td>
              <td>
                <span class={`badge ${stageBadgeClass(app.stage)}`}>{formatStageLabel(app.stage)}</span>
              </td>
              <td class="small">{fmt(app.createdAt)}</td>
              <td>
                <button class="btn btn-sm btn-outline-secondary" onClick={() => setSelectedId(app.id)}>
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
