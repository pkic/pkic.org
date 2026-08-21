import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { api } from "../../api";
import { fmt } from "../../ui";
import { SPONSORSHIP_PIPELINE_STAGES } from "../../types";
import type { Sponsorship, SponsorshipEvent, SponsorshipPipelineStage } from "../../types";
import { stageBadgeClass, stageLabel } from "./shared";
import { SponsorshipLogo } from "./SponsorshipLogo";
import { performAdminAction } from "../../actions";

export function SponsorshipDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
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
        await load();
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
