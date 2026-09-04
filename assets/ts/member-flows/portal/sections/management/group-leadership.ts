/**
 * Presentation helpers for group leadership: the roles are fixed (lead and
 * deputy lead), the titles come from the group type and the assignment.
 */
import {
  GROUP_LEADERSHIP_ROLE_IDS,
  GROUP_LEADERSHIP_TITLE_SUGGESTIONS,
  defaultGroupLeadershipTitle,
  type GroupLeadershipRoleId,
  type GroupLeadershipTitles,
  type GroupMembership,
} from "../../../../../shared/schemas/groups";
import { fmtCalendarDate } from "../../ui";

/** "Chair (lead role)" / "Vice Chair (deputy role)": the type's title, with the authority it carries. */
export function groupLeadershipRoleOptions(
  titles: GroupLeadershipTitles,
): ReadonlyArray<{ value: GroupLeadershipRoleId; label: string }> {
  return GROUP_LEADERSHIP_ROLE_IDS.map((roleId) => ({
    value: roleId,
    label: `${defaultGroupLeadershipTitle(titles, roleId)} (${roleId === "role-group_lead" ? "lead" : "deputy"} role)`,
  }));
}

/** The default title first, then the shared suggestions, without repeats. */
export function groupLeadershipTitleOptions(titles: GroupLeadershipTitles, roleId: GroupLeadershipRoleId): string[] {
  return [...new Set([defaultGroupLeadershipTitle(titles, roleId), ...GROUP_LEADERSHIP_TITLE_SUGGESTIONS[roleId]])];
}

/** "Since 1 Jan 2021", "1 Jan 2021 – 3 Feb 2025", or "1 Jan 2021 – until 30 Jun 2026" for a scheduled end. */
export function formatTerm(startsAt: string, endsAt: string | null, now = new Date().toISOString()): string {
  if (!endsAt) return `Since ${fmtCalendarDate(startsAt)}`;
  if (endsAt > now) return `${fmtCalendarDate(startsAt)} – until ${fmtCalendarDate(endsAt)}`;
  return `${fmtCalendarDate(startsAt)} – ${fmtCalendarDate(endsAt)}`;
}

/** Which Member a person acts for: the organization, or their individual membership. */
export function capacityLabel(
  membership: Pick<GroupMembership, "memberType" | "organizationName"> & {
    membershipCategory?: GroupMembership["membershipCategory"];
  },
): string {
  if (membership.memberType === "organization") return membership.organizationName ?? "Organization";
  return `Individual membership${membership.membershipCategory ? ` (${membership.membershipCategory})` : ""}`;
}
