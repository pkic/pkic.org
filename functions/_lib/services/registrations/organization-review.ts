import { normalizeOrgName } from "../../../../assets/shared/organization-name";
import type { RegistrationConfirmOrganization } from "../../../../assets/shared/schemas/registration";
import type { DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { prepareAuditLog } from "../audit";

/** Queue the existing staff review without creating an organization or granting representation access. */
export function prepareRegistrationOrganizationReview(
  db: DatabaseLike,
  input: {
    registrationId: string;
    userId: string;
    organization: RegistrationConfirmOrganization;
    domain: string | null;
    at: string;
  },
) {
  return [
    db
      .prepare(`INSERT INTO affiliation_reviews (id, user_id, organization_name, normalized_name, job_title, email_domain,
      group_key, source_type, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'registration', ?, ?)
      ON CONFLICT(source_type, source_id) DO NOTHING`)
      .bind(
        uuid(),
        input.userId,
        input.organization.name,
        normalizeOrgName(input.organization.name),
        input.organization.jobTitle ?? null,
        input.domain,
        normalizeOrgName(input.organization.name),
        input.registrationId,
        input.at,
      ),
    prepareAuditLog(
      db,
      "user",
      input.userId,
      "affiliation_review_requested",
      "registration",
      input.registrationId,
      { organizationName: input.organization.name },
      input.at,
    ),
  ];
}
