/**
 * Calendar — ICS download + time-slot preference per subscribed meeting
 * series. Series list is scoped server-side to the
 * consortium series (everyone) plus the series for any working group the
 * member currently belongs to (`listMyMeetingSeries`) — there's nothing to
 * join/leave here, that's the Working Groups tab's job.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { getJson, patchJson, ApiClientError } from "../../../shared/api-client";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { toast, formatStageLabel } from "../ui";
import type { MyMeetingSeries, MyMeetingSeriesPageInfo } from "../types";

function MeetingSeriesCard({ series, onChanged }: { series: MyMeetingSeries; onChanged: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);

  async function setPreference(icsFileId: string | null): Promise<void> {
    setSaving(true);
    try {
      await patchJson(`/api/v1/me/calendar/${series.id}/preference`, { icsFileId });
      toast("Preference saved", "success");
      await onChanged();
    } catch (e) {
      toast(e instanceof ApiClientError ? e.message : "Could not save your preference.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white d-flex align-items-center gap-2">
        <span class="fw-semibold">{series.name}</span>
        <span class="badge text-bg-secondary">{formatStageLabel(series.scopeType)}</span>
      </div>
      <div class="card-body">
        {series.icsFiles.length === 0 ? (
          <p class="text-muted small mb-0">No calendar invite has been uploaded for this series yet.</p>
        ) : (
          <div class="list-group list-group-flush">
            {series.icsFiles.map((file) => (
              <label key={file.id} class="list-group-item d-flex align-items-center gap-3 px-0">
                <input
                  type="radio"
                  class="form-check-input mt-0"
                  name={`pref-${series.id}`}
                  checked={series.preferenceIcsFileId === file.id}
                  disabled={saving}
                  onChange={() => void setPreference(file.id)}
                />
                <span class="flex-grow-1">
                  {file.label} <span class="text-muted small">({file.year})</span>
                </span>
                <a class="btn btn-sm btn-outline-secondary" href={`/api/v1/me/calendar/${series.id}/${file.id}`}>
                  Download
                </a>
              </label>
            ))}
            <label class="list-group-item d-flex align-items-center gap-3 px-0">
              <input
                type="radio"
                class="form-check-input mt-0"
                name={`pref-${series.id}`}
                checked={series.preferenceIcsFileId === null}
                disabled={saving}
                onChange={() => void setPreference(null)}
              />
              <span class="flex-grow-1">
                No preference <span class="text-muted small">(receive all variants on annual resend)</span>
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

export function Calendar() {
  const [series, setSeries] = useState<MyMeetingSeries[] | null>(null);
  const [page, setPage] = useState<MyMeetingSeriesPageInfo | null>(null);
  const pageRef = useRef<MyMeetingSeriesPageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (append = false) => {
    if (append) setLoadingMore(true);
    try {
      const currentPage = pageRef.current;
      const offset = append && currentPage ? currentPage.offset + currentPage.limit : 0;
      const params = new URLSearchParams({ limit: "50", offset: String(offset) });
      const data = await getJson<{ meetingSeries: MyMeetingSeries[]; page: MyMeetingSeriesPageInfo }>(
        `/api/v1/me/calendar?${params.toString()}`,
      );
      setSeries((current) => (append ? [...(current ?? []), ...data.meetingSeries] : data.meetingSeries));
      pageRef.current = data.page;
      setPage(data.page);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load your calendar.");
    } finally {
      if (append) setLoadingMore(false);
    }
  }, []);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorAlert error={error} />;
  if (!series) return <Spinner />;
  if (series.length === 0) {
    return (
      <p class="text-muted">No meeting series are available yet. Join a working group to see its calendar here.</p>
    );
  }

  return (
    <div class="d-flex flex-column gap-3 content-width-schedule">
      <p class="text-muted small">
        Choose a time slot for each meeting series, or download any variant directly. Series you're not subscribed to
        (e.g. from a working group you haven't joined) won't appear here.
      </p>
      {series.map((s) => (
        <MeetingSeriesCard key={s.id} series={s} onChanged={reload} />
      ))}
      {page?.hasMore && (
        <div class="text-center">
          <button class="btn btn-sm btn-outline-primary" disabled={loadingMore} onClick={() => void load(true)}>
            {loadingMore ? "Loading…" : "Load more meeting series"}
          </button>
        </div>
      )}
    </div>
  );
}
