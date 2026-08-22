import { useEffect, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import {
  sponsorsDisplayResponseSchema,
  sponsorsListResponseSchema,
  type PublicSponsor,
  type SponsorsDisplayResponse,
} from "../../shared/schemas/public-sponsors";

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
    void getJson<unknown>(`${apiBase}/sponsors?${buildQuery(filters)}`, { signal: controller.signal })
      .then((response) => setSponsors(sponsorsListResponseSchema.parse(response).sponsors))
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
  const [display, setDisplay] = useState<SponsorsDisplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setDisplay(null);
    setError(null);
    setLoadingMore(false);
    void getJson<unknown>(`${apiBase}/sponsors/display?${buildQuery(filters)}`, { signal: controller.signal })
      .then((response) => setDisplay(sponsorsDisplayResponseSchema.parse(response)))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setDisplay(null);
          setError((cause as Error).message);
          console.error("[sponsors-wall]", cause);
        }
      });
    return () => controller.abort();
  }, [apiBase, filters.eventSlug, filters.eventName, filters.level, filters.minWeight, filters.limit, filters.sort]);
  async function loadMore(): Promise<void> {
    if (!display?.page.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const loaded = display.groups.reduce((count, group) => count + group.sponsors.length, 0);
      const response = sponsorsDisplayResponseSchema.parse(
        await getJson<unknown>(`${apiBase}/sponsors/display?${buildQuery(filters, loaded)}`),
      );
      setDisplay(mergeSponsorDisplayPages(display, response));
    } catch (cause: unknown) {
      setError((cause as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  return { display, error, loadingMore, loadMore };
}

export function sponsorQueryForTest(filters: SponsorFilters, offset = 0): string {
  return buildQuery(filters, offset);
}
