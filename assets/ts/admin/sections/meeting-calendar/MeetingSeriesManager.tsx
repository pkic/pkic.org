import { useState } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { api } from "../../api";
import type { AdminMeetingSeries, MeetingSeriesPageInfo } from "../../types";
import { performAdminAction } from "../../actions";
import {
  adminMeetingSeriesResponseSchema,
  adminMeetingSeriesListResponseSchema,
} from "../../../../shared/schemas/meeting-calendar";
import { useAppendableServerCollection, type CollectionLoader } from "../../../hooks/useServerCollection";
import { MeetingSeriesCard } from "./MeetingSeriesCard";

const loadAdminMeetingPage: CollectionLoader = (url, signal, responseSchema) => api(url, responseSchema, { signal });

function mergeAdminMeetingPages(
  current: { meetingSeries: AdminMeetingSeries[]; page: MeetingSeriesPageInfo },
  next: { meetingSeries: AdminMeetingSeries[]; page: MeetingSeriesPageInfo },
) {
  return { meetingSeries: [...current.meetingSeries, ...next.meetingSeries], page: next.page };
}

function CreateSeriesForm({ baseUrl, onCreated }: { baseUrl: string; onCreated: () => Promise<void> }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    await performAdminAction({
      setBusy: setSaving,
      request: () =>
        api(baseUrl, adminMeetingSeriesResponseSchema, {
          method: "POST",
          body: JSON.stringify({ name: name.trim() }),
        }),
      successMessage: "Meeting series created",
      afterSuccess: async () => {
        setName("");
        setShow(false);
        await onCreated();
      },
    });
  }

  if (!show) {
    return (
      <button class="btn btn-sm btn-outline-success mb-3" onClick={() => setShow(true)}>
        + New meeting series
      </button>
    );
  }

  return (
    <form onSubmit={submit} class="d-flex gap-2 align-items-end mb-3">
      <div>
        <label class="form-label small fw-semibold">Series name</label>
        <input
          class="form-control form-control-sm"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          disabled={saving}
          required
        />
      </div>
      <button type="submit" class="btn btn-sm btn-success" disabled={saving || !name.trim()}>
        {saving ? "Creating…" : "Create"}
      </button>
      <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => setShow(false)} disabled={saving}>
        Cancel
      </button>
    </form>
  );
}

/** Manages meeting series for either the consortium or a single working group, keyed by `baseUrl`. */
export function MeetingSeriesManager({ baseUrl }: { baseUrl: string }) {
  const listing = useAppendableServerCollection({
    endpoint: baseUrl,
    pageSize: 50,
    responseSchema: adminMeetingSeriesListResponseSchema,
    load: loadAdminMeetingPage,
    merge: mergeAdminMeetingPages,
  });
  const series = listing.data?.meetingSeries ?? null;

  if (listing.error) return <ErrorAlert error={listing.error.message} />;
  if (listing.loading && !series) return <Spinner />;
  if (!series) return <Spinner />;

  return (
    <div>
      <CreateSeriesForm baseUrl={baseUrl} onCreated={listing.reload} />
      {series.length === 0 ? (
        <p class="text-muted fst-italic">No meeting series yet.</p>
      ) : (
        <>
          {series.map((s) => (
            <MeetingSeriesCard key={s.id} series={s} baseUrl={baseUrl} onChanged={listing.reload} />
          ))}
          {listing.page?.hasMore && (
            <div class="text-center mb-3">
              <button
                class="btn btn-sm btn-outline-primary"
                disabled={listing.loadingMore}
                onClick={() => void listing.loadMore()}
              >
                {listing.loadingMore ? "Loading…" : "Load more meeting series"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
