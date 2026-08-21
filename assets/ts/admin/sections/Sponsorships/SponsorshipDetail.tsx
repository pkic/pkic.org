import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { api } from "../../api";
import { fmt } from "../../ui";
import { SPONSORSHIP_PIPELINE_STAGES } from "../../types";
import type { Sponsorship, SponsorshipEvent, SponsorshipPipelineStage } from "../../types";
import { stageBadgeClass, stageLabel } from "./shared";
import { SponsorshipLogo } from "./SponsorshipLogo";
import { performAdminAction } from "../../actions";
import { useSponsorshipEventHistory } from "./useSponsorshipEventHistory";

export function SponsorshipDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [sponsorship, setSponsorship] = useState<Sponsorship | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [renewalDate, setRenewalDate] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [nextStage, setNextStage] = useState<SponsorshipPipelineStage>("contacted");
  const [stageNote, setStageNote] = useState("");
  const [busy, setBusy] = useState(false);
  const detailRequestIdRef = useRef(0);
  const history = useSponsorshipEventHistory(id);

  const load = useCallback(async () => {
    const requestId = ++detailRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const detailData = await api<{ sponsorship: Sponsorship }>(`/api/v1/admin/sponsorships/${id}`);
      if (requestId !== detailRequestIdRef.current) return;
      setSponsorship(detailData.sponsorship);
      setNotes(detailData.sponsorship.notes ?? "");
      setRenewalDate(detailData.sponsorship.renewalDate ?? "");
      setAssignedToUserId(detailData.sponsorship.assignedToUserId ?? "");
    } catch (e) {
      if (requestId === detailRequestIdRef.current) setError((e as Error).message);
    } finally {
      if (requestId === detailRequestIdRef.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => {
      detailRequestIdRef.current += 1;
    };
  }, [load]);

  async function saveFields() {
    await performAdminAction({
      setBusy,
      request: () =>
        api(`/api/v1/admin/sponsorships/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            notes: notes.trim() || null,
            renewalDate: renewalDate.trim() || null,
            assignedToUserId: assignedToUserId.trim() || null,
          }),
        }),
      successMessage: "Saved",
      afterSuccess: async () => {
        await load();
        onChanged();
      },
    });
  }

  async function advanceStage() {
    await performAdminAction({
      setBusy,
      request: () =>
        api(`/api/v1/admin/sponsorships/${id}/stage`, {
          method: "PATCH",
          body: JSON.stringify({ toStage: nextStage, note: stageNote.trim() || null }),
        }),
      successMessage: `Stage advanced to ${stageLabel(nextStage)}`,
      afterSuccess: async () => {
        setStageNote("");
        await Promise.all([load(), history.reload()]);
        onChanged();
      },
    });
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

        <section
          aria-labelledby={`sponsorship-history-heading-${id}`}
          aria-busy={history.loading || history.loadingMore}
        >
          <h6 id={`sponsorship-history-heading-${id}`} class="small text-uppercase text-muted mb-2">
            Pipeline history
          </h6>
          <div class="visually-hidden" aria-live="polite">
            {history.announcement}
          </div>
          {history.loading && <Spinner />}
          {history.error && (
            <div class="alert alert-danger" role="alert">
              <span>{history.error}</span>{" "}
              <button type="button" class="btn btn-link btn-sm p-0 align-baseline" onClick={history.retry}>
                Retry history
              </button>
            </div>
          )}
          {!history.loading && history.events.length === 0 && !history.error && (
            <p class="small text-muted mb-0">No pipeline history has been recorded.</p>
          )}
          <ol id={`sponsorship-history-${id}`} class="list-unstyled small mb-0">
            {history.events.map((ev: SponsorshipEvent) => (
              <li key={ev.id} class="mb-1">
                <time class="text-muted" dateTime={ev.createdAt}>
                  {fmt(ev.createdAt)}
                </time>{" "}
                — {ev.fromStage ? `${stageLabel(ev.fromStage)} → ` : ""}
                <strong>{stageLabel(ev.toStage)}</strong>
                {ev.actorName && <span class="text-muted"> by {ev.actorName}</span>}
                {ev.note && <div class="text-muted fst-italic">{ev.note}</div>}
              </li>
            ))}
          </ol>
          {history.page?.hasMore && !history.error && (
            <button
              type="button"
              class="btn btn-outline-secondary btn-sm mt-2"
              aria-controls={`sponsorship-history-${id}`}
              disabled={history.loadingMore}
              onClick={history.loadMore}
            >
              {history.loadingMore ? "Loading…" : "Load older history"}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
