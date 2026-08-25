import type { Group } from "../../../../assets/shared/schemas/groups";
import { resolveOptionalGroupViewer } from "../../../_lib/auth/group-access";
import type { AuthAdmin, AuthMember, DatabaseLike, Env } from "../../../_lib/types";
import { AppError } from "../../../_lib/errors";
import { getPortalGroupContext } from "../../../_lib/services/groups";
import type { GroupResourceViewer } from "../../../_lib/services/resource-grants";

export interface GroupResourceContext {
  group: Group;
  viewer: GroupResourceViewer;
  member?: AuthMember;
}

export function requireGroupManagementActor(viewer: GroupResourceViewer): AuthAdmin {
  if (!viewer.admin) {
    throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
  }
  return viewer.admin;
}

export function requireGroupParticipantMember(context: GroupResourceContext): AuthMember {
  if (!context.member) {
    throw new AppError(403, "GROUP_PARTICIPATION_REQUIRED", "A member portal session is required for participation");
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
  const context = await getPortalGroupContext(
    db,
    {
      userId: resolved.userId,
      ...(resolved.kind === "admin" ? { admin: resolved.admin } : {}),
    },
    groupIdOrSlug,
  );
  return {
    group: context.group,
    viewer: {
      userId: resolved.userId,
      ...(resolved.kind === "admin" ? { admin: resolved.admin } : {}),
    },
    ...(resolved.kind === "member" ? { member: resolved.member } : {}),
  };
}
