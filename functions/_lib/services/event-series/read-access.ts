import type { GroupResourceViewer, LiveGroupResourceContextAccess } from "../resource-grants";
import { activeGroupMembershipAuthorizationEvidence } from "../groups/access";
import { groupManagementAuthorizationEvidence } from "../groups/governance";

/** Live group participation and management evidence shared by event read models. */
export function liveEventResourceContextAccess(
  viewer: GroupResourceViewer,
  groupId: string,
): LiveGroupResourceContextAccess {
  return {
    memberEvidence: activeGroupMembershipAuthorizationEvidence(viewer.userId, groupId),
    managerEvidence: viewer.admin
      ? groupManagementAuthorizationEvidence(viewer.admin, [groupId])
      : { sql: "SELECT 1 WHERE 0", bindings: [] },
  };
}
