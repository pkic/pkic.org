import type { GroupLeadershipAssignment } from "../../../../../shared/schemas/groups";

export const GROUP_LEADERSHIP_ROLE_LABELS: Record<GroupLeadershipAssignment["roleId"], string> = {
  "role-group_lead": "Lead",
  "role-group_deputy_lead": "Deputy lead",
};
