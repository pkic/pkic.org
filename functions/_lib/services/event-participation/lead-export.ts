import { all, first } from "../../db/queries";
import { encodeBoundedCsv } from "../../csv";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../db/types";
import { assertEventContactAccess, eventContactAccessSql } from "./evidence-retention";
import { sponsorConsentSql } from "./sponsor-consent";
import { sponsorLeadPermissionSql } from "./lead-scope";

export const SPONSOR_LEAD_EXPORT_PERMISSION_SQL = sponsorLeadPermissionSql("agenda:leads_export");

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
  await assertEventContactAccess(db, eventId);
  const rows = await all<LeadExportRow>(
    db,
    `SELECT lead.user_id,TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS name,u.email,u.organization_name AS organization,lead.observed_at
    FROM event_sponsor_leads lead JOIN users u ON u.id=lead.user_id
    JOIN registrations reg ON reg.event_id=lead.event_id AND reg.user_id=lead.user_id
    JOIN sponsorships sponsor ON sponsor.id=lead.sponsor_id AND sponsor.event_id=lead.event_id
    WHERE lead.event_id=? AND lead.sponsor_id=? AND reg.status='registered' AND u.active=1
    AND sponsor.sponsor_type='event' AND sponsor.pipeline_stage='active'
    AND ${sponsorConsentSql("reg")}
    AND (${SPONSOR_LEAD_EXPORT_PERMISSION_SQL}) AND ${eventContactAccessSql("lead.event_id")}
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
