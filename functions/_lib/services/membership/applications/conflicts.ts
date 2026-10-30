/**
 * What already stands in the way of a membership application: an organization
 * that is already a member, an applicant who already holds an individual
 * membership or represents an organization, or an application still open for
 * the same person or organization. Read in one round trip; submission and
 * approval both decide from it.
 */
import { batchFirst } from "../../../db/pagination";
import { normalizeOrgName } from "../../../../../assets/shared/organization-name";
import { APPLICATION_TERMINAL_STAGES } from "../../../../../assets/shared/schemas/member-applications";
import type { DatabaseLike } from "../../../types";

export interface MembershipApplicationConflictInput {
  isIndividual: boolean;
  organizationName: string | null;
  organizationId: string | null;
  applicantUserId: string | null;
  applicantEmail: string;
  /** The application being decided, which never conflicts with itself. */
  applicationId?: string | null;
}

export interface MembershipApplicationConflicts {
  memberOrganization: string | null;
  individualMember: boolean;
  representedOrganization: string | null;
  pendingForApplicant: boolean;
  pendingOrganization: string | null;
}

const OPEN_APPLICATION_SQL = `stage NOT IN (${APPLICATION_TERMINAL_STAGES.map(() => "?").join(", ")})`;

export async function readMembershipApplicationConflicts(
  db: DatabaseLike,
  input: MembershipApplicationConflictInput,
): Promise<MembershipApplicationConflicts> {
  const normalizedName = input.organizationName ? normalizeOrgName(input.organizationName) : null;
  const self = input.applicationId ?? "";
  const results = await db.batch([
    db
      .prepare(
        `SELECT organization.name FROM organizations organization
           JOIN members member ON member.organization_id = organization.id AND member.status = 'active'
          WHERE ? = 0 AND (organization.id = ? OR organization.normalized_name = ?)
          LIMIT 1`,
      )
      .bind(input.isIndividual ? 1 : 0, input.organizationId, normalizedName),
    // An individual membership held through a personal identity the person still holds.
    db
      .prepare(
        `SELECT member.id FROM identities personal
           JOIN members member ON member.identity_id = personal.id
            AND member.member_type = 'individual' AND member.status = 'active'
          WHERE ? = 1 AND personal.user_id = ? AND personal.organization_id IS NULL
            AND personal.started_at IS NOT NULL AND personal.ended_at IS NULL AND personal.blocked_at IS NULL
          LIMIT 1`,
      )
      .bind(input.isIndividual ? 1 : 0, input.applicantUserId),
    // Any representation the person holds now; an ended one no longer counts.
    db
      .prepare(
        `SELECT organization.name FROM identities represented
           JOIN organizations organization ON organization.id = represented.organization_id
          WHERE ? = 1 AND represented.user_id = ?
            AND represented.started_at IS NOT NULL AND represented.ended_at IS NULL AND represented.blocked_at IS NULL
          ORDER BY represented.started_at, represented.id
          LIMIT 1`,
      )
      .bind(input.isIndividual ? 1 : 0, input.applicantUserId),
    db
      .prepare(
        `SELECT id FROM member_applications
          WHERE ${OPEN_APPLICATION_SQL} AND id <> ?
            AND (applicant_user_id = ? OR applicant_email = ?)
          LIMIT 1`,
      )
      .bind(...APPLICATION_TERMINAL_STAGES, self, input.applicantUserId, input.applicantEmail),
    db
      .prepare(
        `SELECT organization_name FROM member_applications
          WHERE ${OPEN_APPLICATION_SQL} AND id <> ?
            AND organization_name IS NOT NULL AND lower(trim(organization_name)) = ?
          LIMIT 1`,
      )
      .bind(...APPLICATION_TERMINAL_STAGES, self, input.isIndividual ? null : normalizedName),
  ]);
  return {
    memberOrganization: batchFirst<{ name: string }>(results[0])?.name ?? null,
    individualMember: batchFirst(results[1]) !== null,
    representedOrganization: batchFirst<{ name: string }>(results[2])?.name ?? null,
    pendingForApplicant: batchFirst(results[3]) !== null,
    pendingOrganization: batchFirst<{ organization_name: string }>(results[4])?.organization_name ?? null,
  };
}
