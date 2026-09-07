/**
 * The staff membership-category catalog: codes with their configured labels,
 * ordering, and whether each is an individual or an organization category.
 *
 * `useMembershipCategoryLabels` answers the member-facing question — what does
 * this code say in words — from the public application-form endpoint. Staff
 * surfaces need the rest of the entry as well (display order, the
 * individual/organization split), which is the `membership:read` catalog. Two
 * surfaces already wanted it, so the fetch and its cache live here rather than
 * once per section.
 */
import { useEffect, useState } from "preact/hooks";
import {
  membershipCategoryCatalogResponseSchema,
  type MembershipCategoryCatalogEntry,
} from "../../shared/schemas/membership-categories";
import { getJson } from "../shared/api-client";

let cached: readonly MembershipCategoryCatalogEntry[] | null = null;
let pending: Promise<readonly MembershipCategoryCatalogEntry[]> | null = null;

/**
 * The catalog, or an empty list until it arrives. A surface never blocks on
 * it: every caller falls back to the bare code, which is the durable key.
 */
export function useMembershipCategoryCatalog(): readonly MembershipCategoryCatalogEntry[] {
  const [categories, setCategories] = useState<readonly MembershipCategoryCatalogEntry[]>(cached ?? []);

  useEffect(() => {
    if (cached) {
      setCategories(cached);
      return;
    }
    pending ??= getJson("/api/v1/membership/categories", membershipCategoryCatalogResponseSchema).then(
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
  }, []);

  return categories;
}
