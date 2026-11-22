import {
  groupLabelSchema,
  type AuthenticatedGroup,
  type Group,
  type GroupCapability,
  type GroupManagementConfiguration,
  type GroupWorkspaceResponse,
  type PublicGroup,
} from "../../../../assets/shared/schemas/groups";
import { hasPermission } from "../../auth/permissions";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import {
  readAuthenticatedGroupContext,
  prepareAuthenticatedGroupContext,
  type GroupContextOptions,
} from "./read-model";

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
    abbreviatedName: group.abbreviatedName,
    type: group.type,
    parentGroup: group.parentGroup,
    description: group.description,
    links: group.links,
    visibility: group.visibility,
    publicLeadership: group.publicLeadership,
    publicRoster: group.publicRoster,
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
  options: GroupContextOptions = {},
): Promise<AuthenticatedGroupContext> {
  const context = await readAuthenticatedGroupContext(
    db,
    groupIdOrSlug,
    viewer,
    viewer.admin ? hasPermission(viewer.admin, "groups:read") : false,
    options,
  );
  const { group, visible, participant, guest, manager } = requireAuthenticatedGroupContext(context, viewer);
  const viewable = visible || manager || Boolean(viewer.admin?.scopeRestricted);

  const capabilities: GroupCapability[] = [
    ...(viewable ? (["view"] as const) : []),
    ...(participant && !viewer.admin?.scopeRestricted ? (["participate"] as const) : []),
    ...(manager ? (["manage"] as const) : []),
    // On the team of one of the group's events: it opens that event's record, even where the group is not visible.
    ...(guest && !viewer.admin?.scopeRestricted ? (["guest"] as const) : []),
  ];
  return { group, capabilities };
}

/** Apply the same visibility and delegation policy to standalone and composed group reads. */
export function requireAuthenticatedGroupContext(
  context: ReturnType<ReturnType<typeof prepareAuthenticatedGroupContext>["decode"]>,
  viewer: AuthenticatedGroupViewer,
) {
  if (
    !context ||
    (!context.visible &&
      !context.manager &&
      !(context.guest && context.group.active && !viewer.admin?.scopeRestricted) &&
      !(viewer.admin?.scopeRestricted && context.delegatedAuthorized && context.group.active))
  )
    throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");
  if (!context.delegatedAuthorized) {
    throw new AppError(403, "GROUP_PERMISSION_REQUIRED", "The delegated permissions do not cover this group");
  }
  return context;
}

/** Maps one authenticated group context to a capability-scoped API projection. */
export async function getAuthenticatedGroupDetail(
  db: DatabaseLike,
  viewer: AuthenticatedGroupViewer,
  groupIdOrSlug: string,
): Promise<GroupWorkspaceResponse> {
  // The group page is where a guest's event opens, so it answers guests too.
  const { group, capabilities } = await getAuthenticatedGroupContext(db, viewer, groupIdOrSlug, { guests: true });
  if (!capabilities.includes("view")) {
    return { kind: "guest", group: groupLabelSchema.parse(group), capabilities: ["guest"] };
  }
  const manager = capabilities.includes("manage");
  return {
    group: authenticatedGroupDetail(group),
    capabilities,
    ...(manager ? { configuration: groupManagementConfiguration(group) } : {}),
  };
}
