import type { GroupPortalCapability, GroupPortalContextResponse } from "../../../../assets/shared/schemas/groups";
import { hasPermission } from "../../auth/permissions";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { hasActiveGroupMembership } from "./access";
import { canManageGroup } from "./governance";
import { getGroup, getVisibleGroup } from "./read-model";

export interface PortalGroupViewer {
  userId: string;
  admin?: AuthAdmin;
}

/** Resolves the selected group and its coarse navigation capabilities once. */
export async function getPortalGroupContext(
  db: DatabaseLike,
  viewer: PortalGroupViewer,
  groupIdOrSlug: string,
): Promise<GroupPortalContextResponse> {
  const visibleGroup = await getVisibleGroup(db, groupIdOrSlug, {
    userId: viewer.userId,
    canReadAll: viewer.admin ? hasPermission(viewer.admin, "groups:read") : false,
  });
  const group = visibleGroup ?? (viewer.admin ? await getGroup(db, groupIdOrSlug) : null);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");

  const [participant, manager] = await Promise.all([
    hasActiveGroupMembership(db, viewer.userId, group.id),
    viewer.admin ? canManageGroup(db, viewer.admin, group.id) : Promise.resolve(false),
  ]);
  if (!visibleGroup && !manager) {
    throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");
  }

  const capabilities: GroupPortalCapability[] = [
    "view",
    ...(participant ? (["participate"] as const) : []),
    ...(manager ? (["manage"] as const) : []),
  ];
  return { group, capabilities };
}
