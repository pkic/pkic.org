import { useEffect } from "preact/hooks";
import { publicMembersListResponseSchema } from "../../shared/schemas/members-directory";
import { DEFAULT_PAGE_LIMIT } from "../../shared/schemas/pagination";
import { getJson } from "../shared/api-client";
import { useAppendableServerCollection, type CollectionLoader } from "../hooks/useServerCollection";
import type { z } from "zod";

type DirectoryPage = z.infer<typeof publicMembersListResponseSchema>;
const load: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });
const merge = (current: DirectoryPage, next: DirectoryPage): DirectoryPage => ({
  ...next,
  members: [...current.members, ...next.members],
});

/** Load every bounded server page before exposing the directory's letter anchors. */
export function useMemberDirectory(apiBase: string, group: "organization" | "independent", search: string) {
  const listing = useAppendableServerCollection({
    endpoint: `${apiBase}/members`,
    params: { group, sort: "name", ...(search ? { q: search } : {}) },
    pageSize: DEFAULT_PAGE_LIMIT,
    responseSchema: publicMembersListResponseSchema,
    load,
    merge,
  });
  const { loading, loadingMore, error, page, loadMore } = listing;
  useEffect(() => {
    if (!loading && !loadingMore && !error && page?.hasMore) void loadMore();
  }, [loading, loadingMore, error, page, loadMore]);
  return listing;
}
