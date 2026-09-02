/**
 * The membership-category vocabulary, as words.
 *
 * Category codes ("F", "H5") are the product's durable keys; their labels are
 * editable reference data in D1 and reach the browser through the public
 * application-form endpoint. Member-facing surfaces must not show a bare code
 * — "Category F" tells a member nothing — so this hook resolves codes to the
 * canonical labels, fetched once per session and shared by every caller.
 *
 * Until the catalog arrives (or if it never does), `label()` falls back to
 * "Category <code>", so a surface never blocks on this lookup.
 */
import { useEffect, useState } from "preact/hooks";
import { memberApplicationFormResponseSchema } from "../../shared/schemas/member-applications";
import { getJson } from "../shared/api-client";

type CategoryLabels = ReadonlyMap<string, string>;

let cached: CategoryLabels | null = null;
let pending: Promise<CategoryLabels> | null = null;

async function loadLabels(): Promise<CategoryLabels> {
  const response = await getJson("/api/v1/members/applications/form", memberApplicationFormResponseSchema);
  return new Map(response.categories.map((category) => [category.code, category.label]));
}

/**
 * Resolves category codes to their catalog labels; safe before the fetch
 * lands. Pass `enabled: false` while the surface has no code on screen so a
 * capacity that never shows a category never pays for the catalog.
 */
export function useMembershipCategoryLabels(enabled = true): {
  label: (code: string | null | undefined) => string;
} {
  const [labels, setLabels] = useState<CategoryLabels | null>(cached);

  useEffect(() => {
    if (!enabled) return;
    if (cached) {
      // Another surface resolved the catalog after this one mounted.
      setLabels(cached);
      return;
    }
    pending ??= loadLabels().then(
      (result) => {
        cached = result;
        return result;
      },
      () => {
        // A failed catalog fetch must not fail the page: callers keep the
        // code-based fallback, and the next mount retries.
        pending = null;
        return new Map<string, string>();
      },
    );
    let cancelled = false;
    void pending.then((result) => {
      if (!cancelled && result.size > 0) setLabels(result);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    label: (code) => {
      if (!code) return "";
      const known = labels?.get(code);
      return known ? `${known} (${code})` : `Category ${code}`;
    },
  };
}
