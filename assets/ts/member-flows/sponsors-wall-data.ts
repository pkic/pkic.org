import { useEffect, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import {
  sponsorsDisplayResponseSchema,
  sponsorsListResponseSchema,
  type PublicSponsor,
  type SponsorsDisplayResponse,
} from "../../shared/schemas/public-sponsors";
import { useAppendableServerCollection, type CollectionLoader } from "../hooks/useServerCollection";

/** The public endpoint's shared maximum keeps display work bounded in D1 and the browser. */
export const SPONSOR_DISPLAY_LIMIT = 200;

export interface SponsorFilters {
  eventSlug?: string;
  eventName?: string;
  level?: string;
  minWeight?: number;
  limit?: number;
  sort?: "name" | "-weight";
}

export function mergeSponsorDisplayPages(
  current: SponsorsDisplayResponse,
  next: SponsorsDisplayResponse,
): SponsorsDisplayResponse {
  const groups = new Map(current.groups.map((group) => [group.weight, group]));
  for (const group of next.groups) {
    const previous = groups.get(group.weight);
    groups.set(group.weight, {
      ...group,
      sponsors: previous ? [...previous.sponsors, ...group.sponsors] : group.sponsors,
    });
  }
  return { groups: [...groups.values()].sort((a, b) => b.weight - a.weight), page: next.page };
}

export function sponsorDisplayNextOffset(display: SponsorsDisplayResponse): number {
  return display.groups.reduce((count, group) => count + group.sponsors.length, 0);
}

const loadSponsorDisplayPage: CollectionLoader = (url, signal, responseSchema) =>
  getJson(url, responseSchema, { signal });

function buildQuery(filters: SponsorFilters, offset = 0): string {
  const query = new URLSearchParams({
    limit: String(Math.min(SPONSOR_DISPLAY_LIMIT, Math.max(1, filters.limit ?? SPONSOR_DISPLAY_LIMIT))),
    offset: String(offset),
    sort: filters.sort ?? "-weight",
  });
  if (filters.eventSlug) query.set("eventSlug", filters.eventSlug);
  else if (filters.eventName) query.set("eventName", filters.eventName);
  if (filters.level) query.set("level", filters.level);
  if (filters.minWeight !== undefined) query.set("minWeight", String(filters.minWeight));
  return query.toString();
}

function buildDisplayParams(filters: SponsorFilters): Record<string, string> {
  const query = new URLSearchParams(buildQuery(filters));
  query.delete("limit");
  query.delete("offset");
  return Object.fromEntries(query.entries());
}

export function useSponsorList(
  apiBase: string,
  filters: SponsorFilters,
): {
  sponsors: PublicSponsor[] | null;
  error: string | null;
} {
  const [sponsors, setSponsors] = useState<PublicSponsor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setSponsors(null);
    setError(null);
    if (filters.limit === 0) {
      setSponsors([]);
      return () => controller.abort();
    }
    void getJson(`${apiBase}/sponsors?${buildQuery(filters)}`, sponsorsListResponseSchema, {
      signal: controller.signal,
    })
      .then((response) => setSponsors(response.sponsors))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setSponsors(null);
          setError((cause as Error).message);
          console.error("[sponsors-wall]", cause);
        }
      });
    return () => controller.abort();
  }, [apiBase, filters.eventSlug, filters.eventName, filters.level, filters.minWeight, filters.limit, filters.sort]);
  return { sponsors, error };
}

export function useSponsorDisplay(
  apiBase: string,
  filters: SponsorFilters,
): {
  display: SponsorsDisplayResponse | null;
  error: string | null;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
} {
  const pageSize = Math.min(SPONSOR_DISPLAY_LIMIT, Math.max(1, filters.limit ?? SPONSOR_DISPLAY_LIMIT));
  const listing = useAppendableServerCollection({
    endpoint: `${apiBase}/sponsors/display`,
    params: buildDisplayParams(filters),
    pageSize,
    responseSchema: sponsorsDisplayResponseSchema,
    load: loadSponsorDisplayPage,
    merge: mergeSponsorDisplayPages,
    nextOffset: sponsorDisplayNextOffset,
  });
  return {
    display: listing.data,
    error: listing.error?.message ?? null,
    loadingMore: listing.loadingMore,
    loadMore: listing.loadMore,
  };
}

export function sponsorQueryForTest(filters: SponsorFilters, offset = 0): string {
  return buildQuery(filters, offset);
}
