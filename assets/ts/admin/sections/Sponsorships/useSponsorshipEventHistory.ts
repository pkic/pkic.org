import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ZodError } from "zod";
import {
  sponsorshipEventsListResponseSchema,
  type SponsorshipEvent,
  type SponsorshipEventsListResponse,
} from "../../../../shared/schemas/admin-sponsorships";
import { api } from "../../api";

export interface SponsorshipEventHistoryState {
  events: SponsorshipEvent[];
  page: SponsorshipEventsListResponse["page"] | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  announcement: string;
  loadMore: () => void;
  retry: () => void;
  reload: () => Promise<void>;
}

/** Owns one sponsorship's server-paginated history and rejects stale responses. */
export function useSponsorshipEventHistory(sponsorshipId: string): SponsorshipEventHistoryState {
  const [events, setEvents] = useState<SponsorshipEvent[]>([]);
  const [page, setPage] = useState<SponsorshipEventsListResponse["page"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [failedOffset, setFailedOffset] = useState<number | null>(null);
  const requestIdRef = useRef(0);
  const loadMoreOwnerRef = useRef<number | null>(null);
  const pageLimitRef = useRef(25);

  const loadPage = useCallback(
    async (offset: number): Promise<void> => {
      if (offset > 0 && loadMoreOwnerRef.current !== null) return;
      const requestId = ++requestIdRef.current;
      if (offset === 0) {
        loadMoreOwnerRef.current = null;
        pageLimitRef.current = 25;
        setEvents([]);
        setPage(null);
        setLoading(true);
        setLoadingMore(false);
      } else {
        loadMoreOwnerRef.current = requestId;
        setLoadingMore(true);
      }
      setError(null);
      setFailedOffset(null);
      try {
        const query = offset === 0 ? "" : `?limit=${pageLimitRef.current}&offset=${offset}`;
        const data = await api(
          `/api/v1/admin/sponsorships/${sponsorshipId}/events${query}`,
          sponsorshipEventsListResponseSchema,
        );
        if (requestId !== requestIdRef.current) return;
        pageLimitRef.current = data.page.limit;
        setEvents((previous) => (offset === 0 ? data.events : [...previous, ...data.events]));
        setPage(data.page);
        setAnnouncement(
          offset === 0
            ? `${data.events.length} history ${data.events.length === 1 ? "entry" : "entries"} loaded.`
            : `${data.events.length} additional history ${data.events.length === 1 ? "entry" : "entries"} loaded.`,
        );
      } catch (cause) {
        if (requestId !== requestIdRef.current) return;
        setError(
          cause instanceof ZodError
            ? "Received an invalid pipeline history response."
            : cause instanceof Error
              ? cause.message
              : "Unable to load pipeline history",
        );
        setFailedOffset(offset);
        setAnnouncement("Pipeline history could not be loaded.");
      } finally {
        if (requestId === requestIdRef.current) {
          if (offset === 0) setLoading(false);
          else setLoadingMore(false);
        }
        if (loadMoreOwnerRef.current === requestId) loadMoreOwnerRef.current = null;
      }
    },
    [sponsorshipId],
  );

  const reload = useCallback(() => loadPage(0), [loadPage]);

  useEffect(() => {
    void reload();
    return () => {
      requestIdRef.current += 1;
      loadMoreOwnerRef.current = null;
    };
  }, [reload]);

  function loadMore(): void {
    if (!page?.hasMore || loadingMore || loadMoreOwnerRef.current !== null) return;
    void loadPage(events.length);
  }

  function retry(): void {
    void loadPage(failedOffset ?? 0);
  }

  return { events, page, loading, loadingMore, error, announcement, loadMore, retry, reload };
}
