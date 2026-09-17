/** Shared public category catalog for membership forms, group policy, and labels. */
import { useEffect, useState } from "preact/hooks";
import { type MembershipCategoryCatalogEntry } from "../../shared/schemas/membership-categories";
import { getJson } from "../shared/api-client";
import { memberApplicationFormResponseSchema } from "../../shared/schemas/member-applications";

let cached: readonly MembershipCategoryCatalogEntry[] | null = null;
let pending: Promise<readonly MembershipCategoryCatalogEntry[]> | null = null;

export function invalidateMembershipCategoryCatalog() {
  cached = null;
  pending = null;
}

/**
 * The catalog, or an empty list until it arrives. A surface never blocks on
 * it: every caller falls back to the bare code, which is the durable key.
 */
export function useMembershipCategoryCatalog(enabled = true): readonly MembershipCategoryCatalogEntry[] {
  const [categories, setCategories] = useState<readonly MembershipCategoryCatalogEntry[]>(cached ?? []);

  useEffect(() => {
    if (!enabled) return;
    if (cached) {
      setCategories(cached);
      return;
    }
    pending ??= getJson("/api/v1/members/applications/form", memberApplicationFormResponseSchema).then(
      (response) => {
        cached = response.categories;
        return cached;
      },
      () => {
        // A failed catalog fetch must not fail the page; the next mount retries.
        pending = null;
        return [];
      },
    );
    let cancelled = false;
    void pending.then((result) => {
      if (!cancelled && result.length > 0) setCategories(result);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return categories;
}
