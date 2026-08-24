import type { OrganizationRepresentative } from "../../../../assets/shared/schemas/organization-representation";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { buildAddRepresentativeStatement } from "../membership/representatives";
import { requireOrganizationRepresentativeManagement } from "./authorization";
import { isConcurrentRepresentationConflict } from "./conflicts";
import { loadRepresentationNotificationContext, prepareRepresentationNotification } from "./notifications";
import type { RepresentativeManagerActor } from "./types";
import { AppError } from "../../errors";

export async function associateOrganizationRepresentative(
  db: DatabaseLike,
  actor: RepresentativeManagerActor,
  input: { memberId: string; userId: string; showOnOrganizationProfile: boolean },
): Promise<string> {
  await requireOrganizationRepresentativeManagement(db, {
    memberId: input.memberId,
    actorUserId: actor.userId,
    staffAuthorized: actor.staffAuthorized,
  });
  const notification = await loadRepresentationNotificationContext(db, input.memberId, input.userId, true);
  const source: OrganizationRepresentative["source"] = actor.staffAuthorized ? "staff" : "organization_contact";
  const at = nowIso();
  const { representativeId, statement } = await buildAddRepresentativeStatement(db, {
    memberId: input.memberId,
    userId: input.userId,
    source,
    showOnOrgProfile: input.showOnOrganizationProfile,
    now: at,
  });
  try {
    await db.batch([
      statement,
      prepareScopedAuditLog(
        db,
        { type: "organization", id: input.memberId },
        actor.actorType,
        actor.userId,
        "organization_representative_associated",
        "organization_representative",
        representativeId,
        { userId: input.userId, source },
        at,
      ),
      prepareRepresentationNotification(db, {
        representativeId,
        userId: input.userId,
        context: notification,
        action: "associated",
        at,
      }),
      ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, at),
    ]);
  } catch (error) {
    if (isConcurrentRepresentationConflict(error)) {
      throw new AppError(
        409,
        "ORGANIZATION_REPRESENTATION_CONFLICT",
        "The organization representation changed concurrently; reload and retry",
      );
    }
    throw error;
  }
  return representativeId;
}
