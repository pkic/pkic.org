import type { Group, GroupCapability } from "../../../../assets/shared/schemas/groups";
import { resolveOptionalGroupViewer } from "../../../_lib/auth/group-access";
import type { AuthAdmin, AuthMember, DatabaseLike, Env } from "../../../_lib/types";
import { AppError } from "../../../_lib/errors";
import { getAuthenticatedGroupContext } from "../../../_lib/services/groups";
import type { GroupResourceViewer } from "../../../_lib/services/resource-grants";

export interface GroupResourceContext {
  group: Group;
  capabilities: GroupCapability[];
  viewer: GroupResourceViewer;
  member?: AuthMember;
}

export function requireGroupManagementActor(context: GroupResourceContext): AuthAdmin {
  if (!context.viewer.admin || !context.capabilities.includes("manage")) {
    throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
  }
  return context.viewer.admin;
}

export function requireGroupParticipantMember(context: GroupResourceContext): AuthMember {
  if (!context.member) {
    throw new AppError(403, "GROUP_PARTICIPATION_REQUIRED", "An active membership capacity is required");
  }
  return context.member;
}

export async function requireGroupResourceContext(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  groupIdOrSlug: string,
): Promise<GroupResourceContext> {
  const resolved = await resolveOptionalGroupViewer(db, request, env);
  if (resolved.kind === "public") {
    throw new AppError(401, "AUTH_REQUIRED", "An authenticated portal identity is required");
  }
  const context = await getAuthenticatedGroupContext(
    db,
    {
      userId: resolved.userId,
      ...(resolved.staff ? { admin: resolved.staff } : {}),
    },
    groupIdOrSlug,
  );
  return {
    group: context.group,
    capabilities: context.capabilities,
    viewer: {
      userId: resolved.userId,
      ...(resolved.staff ? { admin: resolved.staff } : {}),
    },
    ...(resolved.member ? { member: resolved.member } : {}),
  };
}
