import type { OrganizationRepresentative } from "../../../../assets/shared/schemas/organization-representation";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { buildAddRepresentativeStatement } from "../membership/representatives";
import {
  prepareOrganizationRepresentativeManagementGuard,
  requireOrganizationRepresentativeManagement,
} from "./authorization";
import { isConcurrentRepresentationConflict } from "./conflicts";
import { loadRepresentationNotificationContext, prepareRepresentationNotification } from "./notifications";
import type { RepresentativeManagerActor } from "./types";
import { AppError } from "../../errors";
import { buildFindOrCreateUserStatement, findUserByEmail, splitPersonName } from "../users";
import type { UserBackedAuthAdmin } from "../../types";
import { serializeLinks } from "../../../../assets/shared/schemas/links";

export async function associateOrganizationRepresentative(
  db: DatabaseLike,
  actor: RepresentativeManagerActor,
  input: { memberId: string; userId: string; showOnOrganizationProfile: boolean },
): Promise<string> {
  await requireOrganizationRepresentativeManagement(db, {
    memberId: input.memberId,
    actorUserId: actor.userId,
    databaseUserId: actor.databaseUserId,
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
      prepareOrganizationRepresentativeManagementGuard(db, {
        memberId: input.memberId,
        actorUserId: actor.userId,
        databaseUserId: actor.databaseUserId,
        staffAuthorized: actor.staffAuthorized,
      }),
      statement,
      prepareScopedAuditLogAfterOneChange(
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
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "ORGANIZATION_REPRESENTATION_MANAGEMENT_CHANGED",
        "Representative-management access changed while the update was being saved",
      );
    }
    if (isConcurrentRepresentationConflict(error) || isAuditChangeGuardFailure(error)) {
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

/**
 * Staff-only direct-email association. This deliberately does not verify the
 * mailbox, enqueue mail, or broaden organization-contact authority; it only
 * provisions the durable identity needed for an explicit staff association.
 */
export async function associateOrganizationRepresentativeByEmail(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  input: {
    memberId: string;
    email: string;
    name: string;
    jobTitle?: string;
    links?: string[];
    showOnOrganizationProfile: boolean;
  },
): Promise<string> {
  const existingUser = await findUserByEmail(db, input.email);
  const { firstName, lastName } = existingUser
    ? { firstName: undefined, lastName: undefined }
    : splitPersonName(input.name);
  const { user, statement: userStatement } = await buildFindOrCreateUserStatement(db, {
    email: input.email,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
    jobTitle: input.jobTitle,
    linksJson: input.links && input.links.length > 0 ? serializeLinks(input.links) : null,
    allowProfileUpdate: true,
  });
  const staffActor: RepresentativeManagerActor = {
    userId: actor.id,
    databaseUserId: actor.id,
    actorType: "admin",
    staffAuthorized: true,
  };
  await requireOrganizationRepresentativeManagement(db, {
    memberId: input.memberId,
    actorUserId: staffActor.userId,
    databaseUserId: staffActor.databaseUserId,
    staffAuthorized: true,
  });
  const at = nowIso();
  const { representativeId, statement } = await buildAddRepresentativeStatement(db, {
    memberId: input.memberId,
    userId: user.id,
    source: "staff",
    showOnOrgProfile: input.showOnOrganizationProfile,
    now: at,
  });
  try {
    await db.batch([
      prepareOrganizationRepresentativeManagementGuard(db, {
        memberId: input.memberId,
        actorUserId: staffActor.userId,
        databaseUserId: staffActor.databaseUserId,
        staffAuthorized: true,
      }),
      ...(userStatement ? [userStatement] : []),
      statement,
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "organization", id: input.memberId },
        "admin",
        actor.id,
        "organization_representative_associated",
        "organization_representative",
        representativeId,
        { userId: user.id, email: user.email, source: "staff" },
        at,
      ),
      ...prepareAutomaticGroupEnrollmentForUserStatements(db, user.id, at),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "ORGANIZATION_REPRESENTATION_MANAGEMENT_CHANGED",
        "Representative-management access changed while the update was being saved",
      );
    }
    if (isConcurrentRepresentationConflict(error) || isAuditChangeGuardFailure(error)) {
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
