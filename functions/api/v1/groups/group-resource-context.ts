import type { Group } from "../../../../assets/shared/schemas/groups";
import { resolveOptionalGroupViewer } from "../../../_lib/auth/group-access";
import type { AuthAdmin, DatabaseLike, Env } from "../../../_lib/types";
import { AppError } from "../../../_lib/errors";
import { getPortalGroupContext } from "../../../_lib/services/groups";
import type { GroupResourceViewer } from "../../../_lib/services/resource-grants";

export interface GroupResourceContext {
  group: Group;
  viewer: GroupResourceViewer;
}

export function requireGroupManagementActor(viewer: GroupResourceViewer): AuthAdmin {
  if (!viewer.admin) {
    throw new AppError(403, "GROUP_MANAGEMENT_REQUIRED", "Effective group management permission is required");
  }
  return viewer.admin;
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
  };
}
