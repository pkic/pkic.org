import type { Group } from "../../../../assets/shared/schemas/groups";
import { resolveOptionalGroupViewer } from "../../../_lib/auth/group-access";
import type { DatabaseLike, Env } from "../../../_lib/types";
import { AppError } from "../../../_lib/errors";
import { getVisibleGroup } from "../../../_lib/services/groups";
import type { GroupResourceViewer } from "../../../_lib/services/resource-grants";

export interface GroupResourceContext {
  group: Group;
  viewer: GroupResourceViewer;
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
  const group = await getVisibleGroup(db, groupIdOrSlug, {
    userId: resolved.userId,
    canReadAll: resolved.canReadAll,
  });
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found or not visible");
  return {
    group,
    viewer: {
      userId: resolved.userId,
      ...(resolved.kind === "admin" ? { admin: resolved.admin } : {}),
    },
  };
}
