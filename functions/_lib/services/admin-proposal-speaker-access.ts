import { getProposalAccessForEvent } from "../auth/proposal-access";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";

export type AdminProposalSpeakerPermission = "review" | "manage";

export async function requireAdminProposalSpeakerPermission(
  db: DatabaseLike,
  actor: AuthAdmin,
  eventId: string,
  permission: AdminProposalSpeakerPermission,
): Promise<void> {
  const access = await getProposalAccessForEvent(db, eventId, actor);
  const allowed = permission === "review" ? access.canReview : access.canFinalize;
  if (allowed) return;
  throw new AppError(
    403,
    "FORBIDDEN",
    permission === "review"
      ? "Missing permission to review proposal speakers"
      : "Missing permission to edit proposal speakers",
  );
}
