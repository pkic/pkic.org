import type {
  AuthenticatedGroup,
  AuthenticatedGroupDetailResponse,
  Group,
  GroupCapability,
  GroupManagementConfiguration,
  PublicGroup,
} from "../../../../assets/shared/schemas/groups";
import { hasPermission } from "../../auth/permissions";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { hasActiveGroupMembership } from "./access";
import { canManageGroup } from "./governance";
import { getGroup, getVisibleGroup } from "./read-model";

export interface AuthenticatedGroupViewer {
  userId: string;
  admin?: AuthAdmin;
}

export interface AuthenticatedGroupContext {
  group: Group;
  capabilities: GroupCapability[];
}

export function publicGroupDetail(group: Group): PublicGroup {
  return {
    id: group.id,
    slug: group.slug,
    name: group.name,
    type: group.type,
    parentGroup: group.parentGroup,
    description: group.description,
    links: group.links,
    visibility: group.visibility,
    publicLeadership: group.publicLeadership,
  };
}

function authenticatedGroupDetail(group: Group): AuthenticatedGroup {
  return {
    ...publicGroupDetail(group),
    active: group.active,
    membershipCapacityCount: group.membershipCapacityCount,
    representedMemberCount: group.representedMemberCount,
    participantCount: group.participantCount,
    childCount: group.childCount,
  };
}

function groupManagementConfiguration(group: Group): GroupManagementConfiguration {
  return {
    governanceInheritanceMode: group.governanceInheritanceMode,
    eligibilityMode: group.eligibilityMode,
    automaticEnrollmentMode: group.automaticEnrollmentMode,
    allowAutomaticOptOut: group.allowAutomaticOptOut,
    minEndorsersForBallot: group.minEndorsersForBallot,
    revision: group.revision,
  };
}

/** Resolves the full internal group context used by server-side resource authorization. */
export async function getAuthenticatedGroupContext(
  db: DatabaseLike,
  viewer: AuthenticatedGroupViewer,
  groupIdOrSlug: string,
): Promise<AuthenticatedGroupContext> {
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

  const capabilities: GroupCapability[] = [
    "view",
    ...(participant ? (["participate"] as const) : []),
    ...(manager ? (["manage"] as const) : []),
  ];
  return { group, capabilities };
}

/** Maps one authenticated group context to a capability-scoped API projection. */
export async function getAuthenticatedGroupDetail(
  db: DatabaseLike,
  viewer: AuthenticatedGroupViewer,
  groupIdOrSlug: string,
): Promise<AuthenticatedGroupDetailResponse> {
  const { group, capabilities } = await getAuthenticatedGroupContext(db, viewer, groupIdOrSlug);
  const manager = capabilities.includes("manage");
  return {
    group: authenticatedGroupDetail(group),
    capabilities,
    ...(manager ? { configuration: groupManagementConfiguration(group) } : {}),
  };
}
