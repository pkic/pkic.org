import type { OrganizationRepresentative } from "../../../../assets/shared/schemas/organization-representation";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import {
  prepareOrganizationRepresentativeManagementGuard,
  requireOrganizationRepresentativeManagement,
} from "./authorization";
import { loadRepresentationNotificationContext, prepareRepresentationNotification } from "./notifications";
import type { RepresentativeManagerActor } from "./types";
import { serializeLinks } from "../../../../assets/shared/schemas/links";

interface RepresentativeStateRow {
  id: string;
  left_at: string | null;
  blocked_at: string | null;
  show_on_org_profile: number;
  updated_at: string;
}

async function commitRepresentativeLifecycleBatch(db: DatabaseLike, statements: StatementLike[]): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "ORGANIZATION_REPRESENTATION_MANAGEMENT_CHANGED",
        "Representative-management access changed while the update was being saved",
      );
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "ORGANIZATION_REPRESENTATION_CHANGED",
        "The organization representation changed concurrently; reload and retry",
      );
    }
    if (error instanceof Error && error.message.includes("REPRESENTATIVE_EMAIL_INVALID")) {
      throw new AppError(
        422,
        "REPRESENTATIVE_EMAIL_INVALID",
        "The selected email must be a verified address owned by this user",
      );
    }
    throw error;
  }
}

async function requireRepresentation(
  db: DatabaseLike,
  memberId: string,
  userId: string,
): Promise<RepresentativeStateRow> {
  const representative = await first<RepresentativeStateRow>(
    db,
    `SELECT id, left_at, blocked_at, show_on_org_profile, updated_at
       FROM organization_representatives
      WHERE member_id = ? AND user_id = ?`,
    [memberId, userId],
  );
  if (!representative) {
    throw new AppError(404, "ORGANIZATION_REPRESENTATIVE_NOT_FOUND", "Organization representative not found");
  }
  return representative;
}

export async function blockOrganizationRepresentative(
  db: DatabaseLike,
  actor: RepresentativeManagerActor,
  input: { memberId: string; userId: string; reason?: string },
): Promise<void> {
  await requireOrganizationRepresentativeManagement(db, {
    memberId: input.memberId,
    actorUserId: actor.userId,
    databaseUserId: actor.databaseUserId,
    staffAuthorized: actor.staffAuthorized,
  });
  const representative = await requireRepresentation(db, input.memberId, input.userId);
  if (representative.blocked_at) {
    throw new AppError(409, "ORGANIZATION_REPRESENTATION_BLOCKED", "The representative is already blocked");
  }
  if (representative.left_at) {
    throw new AppError(409, "ORGANIZATION_REPRESENTATION_INACTIVE", "The representative is already inactive");
  }
  const notification = await loadRepresentationNotificationContext(db, input.memberId, input.userId, false);
  const at = nowIso();
  const statements: StatementLike[] = [
    prepareOrganizationRepresentativeManagementGuard(db, {
      memberId: input.memberId,
      actorUserId: actor.userId,
      databaseUserId: actor.databaseUserId,
      staffAuthorized: actor.staffAuthorized,
    }),
    db
      .prepare(
        `UPDATE organization_representatives
            SET left_at = ?, blocked_at = ?, blocked_by_user_id = ?, updated_at = ?
          WHERE id = ? AND left_at IS NULL AND blocked_at IS NULL`,
      )
      .bind(at, at, actor.databaseUserId ?? (actor.staffAuthorized ? null : actor.userId), at, representative.id),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "organization", id: input.memberId },
      actor.actorType,
      actor.userId,
      "organization_representative_blocked",
      "organization_representative",
      representative.id,
      { userId: input.userId, reason: input.reason ?? null },
      at,
    ),
    prepareRepresentationNotification(db, {
      representativeId: representative.id,
      userId: input.userId,
      context: notification,
      action: "blocked",
      at,
    }),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, at),
  ];
  await commitRepresentativeLifecycleBatch(db, statements);
}

export async function restoreOrganizationRepresentative(
  db: DatabaseLike,
  actor: RepresentativeManagerActor,
  input: { memberId: string; userId: string; reason?: string },
): Promise<void> {
  await requireOrganizationRepresentativeManagement(db, {
    memberId: input.memberId,
    actorUserId: actor.userId,
    databaseUserId: actor.databaseUserId,
    staffAuthorized: actor.staffAuthorized,
  });
  const representative = await requireRepresentation(db, input.memberId, input.userId);
  if (!representative.blocked_at) {
    throw new AppError(409, "ORGANIZATION_REPRESENTATION_NOT_BLOCKED", "The representative is not blocked");
  }
  const notification = await loadRepresentationNotificationContext(db, input.memberId, input.userId, true);
  const at = nowIso();
  const source: OrganizationRepresentative["source"] = actor.staffAuthorized ? "staff" : "organization_contact";
  await commitRepresentativeLifecycleBatch(db, [
    prepareOrganizationRepresentativeManagementGuard(db, {
      memberId: input.memberId,
      actorUserId: actor.userId,
      databaseUserId: actor.databaseUserId,
      staffAuthorized: actor.staffAuthorized,
    }),
    db
      .prepare(
        `UPDATE organization_representatives
            SET source = ?, joined_at = ?, left_at = NULL, blocked_at = NULL,
                blocked_by_user_id = NULL, updated_at = ?
          WHERE id = ? AND blocked_at IS NOT NULL AND left_at IS NOT NULL`,
      )
      .bind(source, at, at, representative.id),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "organization", id: input.memberId },
      actor.actorType,
      actor.userId,
      "organization_representative_restored",
      "organization_representative",
      representative.id,
      { userId: input.userId, reason: input.reason ?? null, source },
      at,
    ),
    prepareRepresentationNotification(db, {
      representativeId: representative.id,
      userId: input.userId,
      context: notification,
      action: "restored",
      at,
    }),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, input.userId, at),
  ]);
}

export async function updateOrganizationRepresentativeProfile(
  db: DatabaseLike,
  actor: RepresentativeManagerActor,
  input: {
    memberId: string;
    userId: string;
    emailId?: string | null;
    jobTitle?: string | null;
    biography?: string | null;
    links?: string[];
    showOnOrganizationProfile?: boolean;
  },
): Promise<string> {
  await requireOrganizationRepresentativeManagement(db, {
    memberId: input.memberId,
    actorUserId: actor.userId,
    databaseUserId: actor.databaseUserId,
    staffAuthorized: actor.staffAuthorized,
  });
  const representative = await requireRepresentation(db, input.memberId, input.userId);
  if (representative.left_at || representative.blocked_at) {
    throw new AppError(409, "ORGANIZATION_REPRESENTATION_INACTIVE", "The representative is not active");
  }
  const at = nowIso();
  await commitRepresentativeLifecycleBatch(db, [
    prepareOrganizationRepresentativeManagementGuard(db, {
      memberId: input.memberId,
      actorUserId: actor.userId,
      databaseUserId: actor.databaseUserId,
      staffAuthorized: actor.staffAuthorized,
    }),
    db
      .prepare(
        `UPDATE organization_representatives
            SET email_id = CASE WHEN ? = 1 THEN ? ELSE email_id END,
                job_title = CASE WHEN ? = 1 THEN ? ELSE job_title END,
                biography = CASE WHEN ? = 1 THEN ? ELSE biography END,
                links_json = CASE WHEN ? = 1 THEN ? ELSE links_json END,
                show_on_org_profile = CASE WHEN ? = 1 THEN ? ELSE show_on_org_profile END,
                updated_at = ?
          WHERE id = ? AND left_at IS NULL AND blocked_at IS NULL AND updated_at = ?`,
      )
      .bind(
        input.emailId !== undefined ? 1 : 0,
        input.emailId ?? null,
        input.jobTitle !== undefined ? 1 : 0,
        input.jobTitle ?? null,
        input.biography !== undefined ? 1 : 0,
        input.biography ?? null,
        input.links !== undefined ? 1 : 0,
        input.links === undefined ? null : serializeLinks(input.links),
        input.showOnOrganizationProfile !== undefined ? 1 : 0,
        input.showOnOrganizationProfile ? 1 : 0,
        at,
        representative.id,
        representative.updated_at,
      ),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "organization", id: input.memberId },
      actor.actorType,
      actor.userId,
      "organization_representative_profile_updated",
      "organization_representative",
      representative.id,
      {
        userId: input.userId,
        memberId: input.memberId,
        fields: Object.keys(input)
          .filter((field) => !["memberId", "userId"].includes(field))
          .sort(),
      },
      at,
    ),
  ]);
  return representative.id;
}
