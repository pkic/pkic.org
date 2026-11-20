/** Live, exact sponsor capture access for an active representative of its organization. */
export function sponsorOrganizationCapturePredicateSql(identityAlias: string, sponsorAlias: string): string {
  return `${identityAlias}.organization_id IS NOT NULL
    AND ${identityAlias}.started_at IS NOT NULL
    AND ${identityAlias}.ended_at IS NULL
    AND ${identityAlias}.blocked_at IS NULL
    AND ${sponsorAlias}.sponsor_type='event'
    AND ${sponsorAlias}.pipeline_stage='active'
    AND ${sponsorAlias}.ended_reason IS NULL
    AND (${sponsorAlias}.renewal_date IS NULL OR ${sponsorAlias}.renewal_date>strftime('%Y-%m-%d','now'))
    AND ${sponsorAlias}.event_id IS NOT NULL`;
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
