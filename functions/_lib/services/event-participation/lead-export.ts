import { all, first } from "../../db/queries";
import { encodeBoundedCsv } from "../../csv";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../db/types";
import { sponsorConsentSql } from "./sponsor-consent";

export const SPONSOR_LEAD_EXPORT_PERMISSION_SQL = `
EXISTS(SELECT 1 FROM permission_grants g JOIN users operator ON operator.id=g.user_id
 WHERE g.user_id=? AND operator.active=1 AND g.permission='agenda:leads_export'
 AND g.context_type='event_sponsor' AND g.context_id=? AND g.revoked_at IS NULL
 AND (g.expires_at IS NULL OR g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
OR EXISTS(SELECT 1 FROM user_roles role JOIN role_permissions rp ON rp.role_id=role.role_id
 JOIN users operator ON operator.id=role.user_id WHERE role.user_id=? AND operator.active=1
 AND role.member_id IS NULL AND rp.permission='agenda:leads_export'
 AND role.context_type='event_sponsor' AND role.context_id=? AND role.revoked_at IS NULL
 AND (role.expires_at IS NULL OR role.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`;

interface LeadExportRow {
  user_id: string;
  name: string;
  email: string;
  organization: string | null;
  observed_at: string;
}

/** Live contacts are read only for an explicit, active sponsor export scope. */
export async function exportSponsorLeads(db: DatabaseLike, eventId: string, sponsorId: string, operatorUserId: string) {
  const scopeValues = [operatorUserId, sponsorId, operatorUserId, sponsorId];
  const sponsorship = await first(
    db,
    `SELECT id FROM sponsorships WHERE id=? AND event_id=? AND sponsor_type='event' AND pipeline_stage='active'`,
    [sponsorId, eventId],
  );
  if (!sponsorship) throw new AppError(404, "LEAD_SPONSOR_NOT_FOUND", "Active sponsorship not found in this event.");
  if (!(await first(db, `SELECT 1 WHERE (${SPONSOR_LEAD_EXPORT_PERMISSION_SQL})`, scopeValues)))
    throw new AppError(403, "LEAD_EXPORT_SCOPE_REQUIRED", "An active sponsor-specific lead export grant is required.");
  const rows = await all<LeadExportRow>(
    db,
    `SELECT lead.user_id,TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS name,u.email,u.organization_name AS organization,lead.observed_at
    FROM event_sponsor_leads lead JOIN users u ON u.id=lead.user_id
    JOIN registrations reg ON reg.event_id=lead.event_id AND reg.user_id=lead.user_id
    JOIN sponsorships sponsor ON sponsor.id=lead.sponsor_id AND sponsor.event_id=lead.event_id
    WHERE lead.event_id=? AND lead.sponsor_id=? AND reg.status='registered' AND u.active=1
    AND sponsor.sponsor_type='event' AND sponsor.pipeline_stage='active'
    AND ${sponsorConsentSql("reg")}
    AND (${SPONSOR_LEAD_EXPORT_PERMISSION_SQL})
    ORDER BY lead.observed_at,lead.user_id LIMIT 100001`,
    [eventId, sponsorId, ...scopeValues],
  );
  if (rows.length > 100000) throw new AppError(413, "CSV_EXPORT_TOO_LARGE", "Export must not exceed 100000 leads.");
  return encodeBoundedCsv(
    [
      ["Attendee ID", "Name", "Email", "Organization", "Captured at"],
      ...rows.map((row) => [row.user_id, row.name, row.email, row.organization, row.observed_at]),
    ],
    20 * 1024 * 1024,
  );
}
