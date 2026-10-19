/**
 * Where the viewer stands in a group, as the word badges a group card and a
 * groups list row both show — the group counterpart of an event's
 * "Registered": "Joined via Example Corp", "Joined as individual member".
 *
 * Several affiliations make one badge, with the names in its description,
 * so a reader who represents three organizations gets one line, not three.
 */
import type { SelfGroup } from "../../../../shared/schemas/group-participation";
import { formatNumber } from "../../../../shared/format-number";
import type { CollectionStatus } from "../../../ui/CollectionCard";
import { affiliationLabel } from "./group-participation-commands";

function joinedVia(membership: SelfGroup["memberships"][number]): string {
  return membership.organizationName ? `Joined via ${membership.organizationName}` : "Joined as individual member";
}

export function groupViewerStatus(group: Pick<SelfGroup, "memberships">): CollectionStatus[] {
  const [only, ...others] = group.memberships;
  if (!only) return [];
  if (others.length === 0) return [{ label: joinedVia(only) }];
  return [
    {
      label: `Joined via ${formatNumber(group.memberships.length)} affiliations`,

      description: group.memberships.map((membership) => affiliationLabel(membership)).join(", "),
    },
  ];
}
