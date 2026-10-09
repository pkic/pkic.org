import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { REGISTRATION_JOB_TITLE_SQL, REGISTRATION_ORGANIZATION_SQL } from "../registrations/selected-identity";
import {
  loadRegistrationBadgeRole,
  registrationBadgeDisplayRole,
  registrationBadgeRoleEvidence,
} from "../registrations/badge-role";
import { eventContactAccessSql } from "./evidence-retention";

const canDisplay = `u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL AND ${eventContactAccessSql("credential.event_id")}`;
const projection = `SELECT r.id AS registrationId,credential.user_id AS userId,r.registration_identity_id AS selectedIdentityId,r.registration_organization_name AS registrationOrganizationName,
  CASE WHEN ${canDisplay} THEN COALESCE(u.preferred_name,u.first_name) ELSE NULL END AS firstName,
  CASE WHEN ${canDisplay} THEN u.last_name ELSE NULL END AS lastName,
  CASE WHEN ${canDisplay} THEN ${REGISTRATION_ORGANIZATION_SQL} ELSE NULL END AS organization,
  CASE WHEN ${canDisplay} THEN ${REGISTRATION_JOB_TITLE_SQL} ELSE NULL END AS jobTitle
  FROM event_badge_credentials credential JOIN registrations r ON r.event_id=credential.event_id AND r.user_id=credential.user_id
  JOIN users u ON u.id=credential.user_id WHERE credential.event_id=? AND credential.id=?`;
interface PrintMetadataRow {
  registrationId: string;
  userId: string;
  selectedIdentityId: string | null;
  registrationOrganizationName: string | null;
  firstName: string | null;
  lastName: string | null;
  organization: string | null;
  jobTitle: string | null;
}

/** Labels are transient authorized print data; registration-selected representation takes precedence. */
export async function prepareBadgePrintMetadata(db: DatabaseLike, eventId: string, badgeId: string) {
  const row = await first<PrintMetadataRow>(db, projection, [eventId, badgeId]);
  if (!row) throw new AppError(404, "BADGE_NOT_FOUND", "Badge unavailable.");
  const role = await loadRegistrationBadgeRole(db, eventId, row.registrationId);
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    organization: row.organization,
    jobTitle: row.jobTitle,
    badgeRole: registrationBadgeDisplayRole(role.response.effective_role),
    guards: [
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM (${projection}) captured WHERE captured.registrationId=? AND captured.userId=? AND captured.selectedIdentityId IS ? AND captured.registrationOrganizationName IS ? AND captured.firstName IS ? AND captured.lastName IS ? AND captured.organization IS ? AND captured.jobTitle IS ?`,
        bindings: [
          eventId,
          badgeId,
          row.registrationId,
          row.userId,
          row.selectedIdentityId,
          row.registrationOrganizationName,
          row.firstName,
          row.lastName,
          row.organization,
          row.jobTitle,
        ],
      }),
      prepareAuthorizationGuard(db, registrationBadgeRoleEvidence(eventId, role)),
    ],
  };
}
