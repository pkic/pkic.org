import type { AuthAdmin, DatabaseLike } from "../types";
import { hasVoteManagementAuthorization } from "../services/votes/vote-access";
import { AppError } from "../errors";

export async function requireVoteManagementAccess(
  db: DatabaseLike,
  actor: AuthAdmin,
  voteId: string,
  throughGroupId?: string,
): Promise<void> {
  if (!(await hasVoteManagementAuthorization(db, actor, voteId, throughGroupId))) {
    throw new AppError(403, "VOTE_MANAGEMENT_REQUIRED", "Effective vote management permission is required");
  }
}
