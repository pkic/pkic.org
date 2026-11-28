import { eventTeamScannerRoleScopeSql } from "./event-team-scanner-scope";
import {
  sponsorLeadViewerPredicateSql,
  sponsorOrganizationCapturePredicateSql,
} from "./sponsor-organization-lead-access";

/**
 * One canonical live grant policy; callers only vary the prepared context input.
 *
 * `requested` leads every branch and each table is reached by key from the
 * person, so the cost follows the people asked for and never the size of a
 * table. `lead_viewer_candidates` only narrows which sponsorships the lead
 * viewer policy is asked about: that policy matches a sponsorship through one
 * of the person's addresses or one of their organizations, so a sponsorship
 * outside both can never pass it. The policy itself still decides. The unary
 * plus keeps the mailbox comparison free of column affinity, which is what
 * lets it seek the mailbox index; the capture branch finds an organization's
 * sponsorships by organization before it reads them by id for the same reason.
 */
export function contextGrantSelection(requested: string, bindings: unknown[]) {
  return {
    sql: `WITH requested AS (${requested}),
     lead_viewer_candidates(user_id,sponsor_id) AS (
       SELECT viewer.id,sponsor.id
       FROM (SELECT DISTINCT user_id FROM requested) asked CROSS JOIN users viewer ON viewer.id=asked.user_id
       CROSS JOIN sponsorships sponsor ON sponsor.contact_email IS NOT NULL
         AND lower(trim(sponsor.contact_email))=+viewer.normalized_email
       UNION
       SELECT address.user_id,sponsor.id
       FROM (SELECT DISTINCT user_id FROM requested) asked CROSS JOIN user_emails address ON address.user_id=asked.user_id
       CROSS JOIN sponsorships sponsor ON sponsor.contact_email IS NOT NULL
         AND lower(trim(sponsor.contact_email))=+address.normalized_email
       UNION
       SELECT held.user_id,sponsor.id
       FROM (SELECT DISTINCT user_id FROM requested) asked CROSS JOIN identities held ON held.user_id=asked.user_id
       CROSS JOIN sponsorships sponsor ON sponsor.organization_id=held.organization_id)
     SELECT requested.request_index,requested.member_id,rp.permission,ur.context_type,ur.context_id
     FROM requested JOIN user_roles ur ON ur.user_id=requested.user_id
     JOIN role_permissions rp ON rp.role_id=ur.role_id
     WHERE ur.revoked_at IS NULL
       AND ${eventTeamScannerRoleScopeSql("ur", "rp")}
       AND (ur.expires_at IS NULL OR ur.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       AND (ur.member_id IS NULL OR (ur.member_id=requested.member_id AND ur.context_type='group'
         AND EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.group_id=ur.context_id
           AND gm.user_id=ur.user_id AND gm.member_id=ur.member_id AND gm.left_at IS NULL)))
     UNION ALL
     SELECT requested.request_index,requested.member_id,pg.permission,pg.context_type,pg.context_id
     FROM requested CROSS JOIN permission_grants pg ON pg.user_id=requested.user_id
     WHERE pg.revoked_at IS NULL
       AND (pg.expires_at IS NULL OR pg.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     UNION ALL
     SELECT DISTINCT requested.request_index,requested.member_id,'agenda:leads_capture','event_sponsor',sponsor.id
     FROM requested CROSS JOIN identities linked_identity ON linked_identity.user_id=requested.user_id
     CROSS JOIN users linked_operator ON linked_operator.id=linked_identity.user_id
     CROSS JOIN sponsorships organization_sponsor ON organization_sponsor.organization_id=linked_identity.organization_id
     CROSS JOIN sponsorships sponsor ON sponsor.id=organization_sponsor.id
     WHERE linked_operator.active=1 AND linked_operator.pii_redacted_at IS NULL
       AND linked_operator.merged_into_user_id IS NULL
       AND ${sponsorOrganizationCapturePredicateSql("linked_identity", "sponsor")}
     UNION ALL
     SELECT DISTINCT requested.request_index,requested.member_id,lead_permission.value,'event_sponsor',sponsor.id
     FROM requested CROSS JOIN lead_viewer_candidates candidate ON candidate.user_id=requested.user_id
     CROSS JOIN sponsorships sponsor
       ON sponsor.id=candidate.sponsor_id AND ${sponsorLeadViewerPredicateSql("requested.user_id", "sponsor")}
     JOIN json_each('["agenda:leads_view","agenda:leads_export"]') lead_permission`,
    bindings,
  };
}
