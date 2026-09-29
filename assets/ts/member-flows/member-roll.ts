/**
 * "Which member organizations are these?", asked once.
 *
 * The charter sentence and the OG card's logo wall want the same answer in
 * two shapes — names in a row of prose, logos on a background — so they read
 * the same canonical roll rather than each fetching its own. A member, not a
 * seat: an organization with five people in a working group is listed once,
 * because its representatives inherit its membership (#8).
 *
 * `workingGroup` narrows the roll to one group by slug; omitted, it is the
 * whole membership. Sorting, filtering and pagination are the endpoint's,
 * not this module's.
 */
import { useEffect, useState } from "preact/hooks";
import { publicMembersListResponseSchema, type PublicMemberSummary } from "../../shared/schemas/members-directory";
import { getJson } from "../shared/api-client";

export const API_BASE_FALLBACK = "/api/v1";

/**
 * `null` while the roll is still being read, an array once it is known —
 * empty both when the group has no members and when the read failed. Every
 * surface using this renders beside content that stands without it (a charter
 * row, a social card), so a failure shows nothing rather than an error.
 */
export function useMemberRoll(
  apiBase: string,
  options: { workingGroup?: string; limit: number },
): readonly PublicMemberSummary[] | null {
  const { workingGroup, limit } = options;
  const [members, setMembers] = useState<readonly PublicMemberSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ group: "organization", limit: String(limit), sort: "name" });
    if (workingGroup) query.set("workingGroup", workingGroup);
    void getJson(`${apiBase}/members?${query.toString()}`, publicMembersListResponseSchema).then(
      (page) => {
        if (!cancelled) setMembers(page.members);
      },
      () => {
        if (!cancelled) setMembers([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [apiBase, workingGroup, limit]);

  return members;
}
