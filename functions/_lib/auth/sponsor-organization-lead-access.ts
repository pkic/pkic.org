import { REPRESENTATIVE_ROLE_IDS } from "../../../assets/shared/schemas/representative-roles";
import { organizationContactRoleActivePredicate } from "./organization-contact-role";

export function activeEventSponsorSql(sponsorAlias: string): string {
  return `${sponsorAlias}.sponsor_type='event'
    AND ${sponsorAlias}.pipeline_stage='active'
    AND ${sponsorAlias}.ended_reason IS NULL
    AND (${sponsorAlias}.renewal_date IS NULL OR ${sponsorAlias}.renewal_date>strftime('%Y-%m-%d','now'))
    AND ${sponsorAlias}.event_id IS NOT NULL`;
}

/** Live, exact sponsor capture access for an active representative of its organization. */
export function sponsorOrganizationCapturePredicateSql(identityAlias: string, sponsorAlias: string): string {
  return `${identityAlias}.organization_id IS NOT NULL
    AND ${identityAlias}.started_at IS NOT NULL
    AND ${identityAlias}.ended_at IS NULL
    AND ${identityAlias}.blocked_at IS NULL
    AND ${activeEventSponsorSql(sponsorAlias)}`;
}

/** Internal SQL expressions only; bind the user and sponsor values at each caller. */
export function sponsorOrganizationCaptureExistsSql(
  userExpression: string,
  sponsorExpression?: string,
  eventExpression?: string,
): string {
  return `EXISTS(SELECT 1 FROM identities linked_identity
    JOIN sponsorships linked_sponsor ON linked_sponsor.organization_id=linked_identity.organization_id
    JOIN users linked_operator ON linked_operator.id=linked_identity.user_id
    WHERE linked_identity.user_id=${userExpression}
      AND linked_operator.active=1 AND linked_operator.pii_redacted_at IS NULL
      AND linked_operator.merged_into_user_id IS NULL
      AND ${sponsorOrganizationCapturePredicateSql("linked_identity", "linked_sponsor")}
      ${sponsorExpression ? `AND linked_sponsor.id=${sponsorExpression}` : ""}
      ${eventExpression ? `AND linked_sponsor.event_id=${eventExpression}` : ""})`;
}

/** Only the verified sponsorship mailbox or its member organization's active primary contact sees all leads. */
export function sponsorLeadViewerPredicateSql(userExpression: string, sponsorAlias: string): string {
  return `${activeEventSponsorSql(sponsorAlias)}
    AND EXISTS(SELECT 1 FROM users viewer WHERE viewer.id=${userExpression}
      AND viewer.active=1 AND viewer.pii_redacted_at IS NULL AND viewer.merged_into_user_id IS NULL
      AND (
        (${sponsorAlias}.contact_email IS NOT NULL AND (
          viewer.normalized_email=lower(trim(${sponsorAlias}.contact_email))
          OR EXISTS(SELECT 1 FROM user_emails verified_email
            WHERE verified_email.user_id=viewer.id AND verified_email.verified_at IS NOT NULL
              AND verified_email.normalized_email=lower(trim(${sponsorAlias}.contact_email)))
        ))
        OR EXISTS(SELECT 1 FROM members member
          JOIN user_roles role ON role.context_type='organization' AND role.context_id=member.id
            AND role.role_id='${REPRESENTATIVE_ROLE_IDS.primaryContact}' AND role.user_id=viewer.id
          JOIN identities identity ON identity.id=role.identity_id AND identity.user_id=viewer.id
            AND identity.organization_id=${sponsorAlias}.organization_id
          JOIN identity_member_capacities capacity
            ON capacity.identity_id=identity.id AND capacity.member_id=member.id
          WHERE member.organization_id=${sponsorAlias}.organization_id AND member.status='active'
            AND ${organizationContactRoleActivePredicate(
              "role",
              "viewer",
              "identity",
              "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            )})
      ))`;
}

/** Internal SQL expressions only; callers bind user and sponsor IDs. */
export function sponsorLeadViewerExistsSql(userExpression: string, sponsorExpression: string): string {
  return `EXISTS(SELECT 1 FROM sponsorships viewer_sponsor
    WHERE viewer_sponsor.id=${sponsorExpression}
      AND ${sponsorLeadViewerPredicateSql(userExpression, "viewer_sponsor")})`;
}

/** Staff sign-in needs only the mailbox path; organization contacts already hold a user role. */
export function sponsorContactMailboxExistsSql(userExpression: string): string {
  return `EXISTS(SELECT 1 FROM sponsorships contact_sponsor JOIN users contact_user
    ON contact_user.id=${userExpression}
    WHERE ${activeEventSponsorSql("contact_sponsor")}
      AND contact_user.active=1 AND contact_user.pii_redacted_at IS NULL
      AND contact_user.merged_into_user_id IS NULL AND contact_sponsor.contact_email IS NOT NULL
      AND (contact_user.normalized_email=lower(trim(contact_sponsor.contact_email))
        OR EXISTS(SELECT 1 FROM user_emails verified_contact
          WHERE verified_contact.user_id=contact_user.id AND verified_contact.verified_at IS NOT NULL
            AND verified_contact.normalized_email=lower(trim(contact_sponsor.contact_email)))))`;
}
