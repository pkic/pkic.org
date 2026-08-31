import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { getJson, patchJson } from "../../../../../shared/api-client";
import {
  sponsorshipResponseSchema,
  SPONSORSHIP_PIPELINE_STAGES,
} from "../../../../../../shared/schemas/sponsorship-management";
import { fmt, toast } from "../../../ui";
import type {
  Sponsorship,
  SponsorshipEvent,
  SponsorshipPipelineStage,
} from "../../../../../../shared/schemas/sponsorship-management";
import { Badge, statusLabel } from "../../../../../components/Badge";
import { SponsorshipLogo } from "./SponsorshipLogo";
import { useSponsorshipEventHistory } from "./useSponsorshipEventHistory";

export function SponsorshipDetail({
  id,
  canWrite,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  onChanged?: () => void;
}) {
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
      const detailData = await getJson(`/api/v1/sponsors/${encodeURIComponent(id)}`, sponsorshipResponseSchema);
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
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/sponsors/${encodeURIComponent(id)}`,
        {
          notes: notes.trim() || null,
          renewalDate: renewalDate.trim() || null,
          assignedToUserId: assignedToUserId.trim() || null,
        },
        sponsorshipResponseSchema,
      );
      toast("Saved", "success");
      await load();
      onChanged?.();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function advanceStage() {
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/sponsors/${encodeURIComponent(id)}/stage`,
        { toStage: nextStage, note: stageNote.trim() || null },
        sponsorshipResponseSchema,
      );
      toast(`Stage advanced to ${statusLabel(nextStage)}`, "success");
      setStageNote("");
      await Promise.all([load(), history.reload()]);
      onChanged?.();
    } catch (error) {
      toast((error as Error).message, "error");
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
          <Badge status={sponsorship.pipelineStage} />
        </div>

        {sponsorship.contactEmail && (
          <p class="small mb-3">
            Contact: {sponsorship.contactName ?? sponsorship.contactEmail} &lt;{sponsorship.contactEmail}&gt;
          </p>
        )}

        {canWrite && !sponsorship.organizationId && <SponsorshipLogo sponsorship={sponsorship} onChanged={load} />}

        {canWrite && (
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
        )}
        {canWrite && (
          <button type="button" class="btn btn-outline-primary btn-sm mb-3" disabled={busy} onClick={saveFields}>
            Save fields
          </button>
        )}

        {canWrite && <hr />}

        {canWrite && (
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
                    {statusLabel(s)}
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
        )}

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
                — {ev.fromStage ? `${statusLabel(ev.fromStage)} → ` : ""}
                <strong>{statusLabel(ev.toStage)}</strong>
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
