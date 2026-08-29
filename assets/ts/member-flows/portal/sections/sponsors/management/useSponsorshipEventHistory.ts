import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ZodError } from "zod";
import {
  sponsorshipEventsListResponseSchema,
  type SponsorshipEvent,
  type SponsorshipEventsListResponse,
} from "../../../../../../shared/schemas/sponsorship-management";
import { getJson } from "../../../../../shared/api-client";
import { useAppendableServerCollection, type CollectionLoader } from "../../../../../hooks/useServerCollection";

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

const SPONSORSHIP_EVENT_PAGE_SIZE = 25;

const loadSponsorshipEvents: CollectionLoader = (url, signal, responseSchema) =>
  getJson(url, responseSchema, { signal });

function mergeSponsorshipEventPages(
  current: SponsorshipEventsListResponse,
  next: SponsorshipEventsListResponse,
): SponsorshipEventsListResponse {
  return { events: [...current.events, ...next.events], page: next.page };
}

/** Owns one sponsorship's server-paginated history through the shared collection controller. */
export function useSponsorshipEventHistory(sponsorshipId: string): SponsorshipEventHistoryState {
  const [announcement, setAnnouncement] = useState("");
  const previousDataRef = useRef<SponsorshipEventsListResponse | null>(null);
  const listing = useAppendableServerCollection({
    endpoint: `/api/v1/sponsors/${encodeURIComponent(sponsorshipId)}/events`,
    pageSize: SPONSORSHIP_EVENT_PAGE_SIZE,
    responseSchema: sponsorshipEventsListResponseSchema,
    load: loadSponsorshipEvents,
    merge: mergeSponsorshipEventPages,
    clearDataOnReload: true,
  });

  useEffect(() => {
    if (listing.error) {
      setAnnouncement("Pipeline history could not be loaded.");
      return;
    }
    if (!listing.data) return;
    const previous = previousDataRef.current;
    const appendedCount =
      previous && listing.data.page.offset > 0 ? listing.data.events.length - previous.events.length : 0;
    const loadedCount = listing.data.page.offset > 0 ? appendedCount : listing.data.events.length;
    setAnnouncement(
      listing.data.page.offset > 0
        ? `${loadedCount} additional history ${loadedCount === 1 ? "entry" : "entries"} loaded.`
        : `${loadedCount} history ${loadedCount === 1 ? "entry" : "entries"} loaded.`,
    );
    previousDataRef.current = listing.data;
  }, [listing.data, listing.error]);

  const retry = useCallback((): void => {
    if (listing.data?.page.hasMore) void listing.loadMore();
    else void listing.reload();
  }, [listing.data, listing.loadMore, listing.reload]);

  const error = listing.error
    ? listing.error instanceof ZodError
      ? "Received an invalid pipeline history response."
      : listing.error.message || "Unable to load pipeline history"
    : null;

  return {
    events: listing.data?.events ?? [],
    page: listing.page,
    loading: listing.loading,
    loadingMore: listing.loadingMore,
    error,
    announcement,
    loadMore: () => void listing.loadMore(),
    retry,
    reload: listing.reload,
  };
}
