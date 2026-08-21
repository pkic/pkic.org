import type { AuthAdmin, DatabaseLike } from "../types";
import { getVoteScopeForPermissionCheck } from "../services/votes";
import { requirePermission } from "./permissions";

export async function requireVoteManagementAccess(db: DatabaseLike, actor: AuthAdmin, voteId: string): Promise<void> {
  const scope = await getVoteScopeForPermissionCheck(db, voteId);
  requirePermission(
    actor,
    "votes:manage",
    scope.scopeType === "working_group" && scope.scopeId ? { type: "working_group", id: scope.scopeId } : undefined,
  );
}
