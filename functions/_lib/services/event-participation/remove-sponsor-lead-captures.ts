import { sponsorLeadRemovalResponseSchema } from "../../../../assets/shared/schemas/event-sponsor-lead-list";
import { batchFirst } from "../../db/pagination";
import type { DatabaseLike } from "../../db/types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { auditActorIdentityId } from "../audit-actor";
import { activeEventSponsorSql, sponsorLeadViewerPredicateSql } from "../../auth/sponsor-organization-lead-access";
import { sponsorLeadPermissionBindings, sponsorLeadPermissionSql } from "./lead-scope";
import { activeSponsorCaptureSql } from "./sponsor-lead-active";

/** Clears selected lead scans and refreshes the shared lead in one guarded command. */
export async function removeSponsorLeadCaptures(
  db: DatabaseLike,
  eventId: string,
  sponsorId: string,
  leadId: string,
  actorUserId: string,
  scope: "mine" | "all",
) {
  const removalId = crypto.randomUUID();
  const removedAt = nowIso();
  const scopeSql =
    scope === "all"
      ? sponsorLeadViewerPredicateSql("?", "sponsor")
      : sponsorLeadPermissionSql("agenda:leads_capture", "sponsor.id");
  const scopeValues =
    scope === "all" ? [actorUserId] : sponsorLeadPermissionBindings("agenda:leads_capture", actorUserId);
  const ownSql = scope === "mine" ? "AND attempt.operator_user_id=?" : "";
  const results = await db.batch([
    db
      .prepare(`UPDATE event_scan_attempts SET sponsor_lead_removed_at=?,sponsor_lead_removal_id=?,
        user_id=NULL,badge_id=NULL,scanned_value=NULL,scanned_value_truncated=NULL,
        request_hash=lower(hex(randomblob(32)))
      WHERE id IN (SELECT attempt.id FROM event_scan_attempts attempt
      JOIN event_sponsor_leads lead ON lead.event_id=attempt.event_id AND lead.sponsor_id=attempt.sponsor_id AND lead.user_id=attempt.user_id
      JOIN sponsorships sponsor ON sponsor.id=lead.sponsor_id AND sponsor.event_id=lead.event_id
      WHERE lead.id=? AND lead.event_id=? AND lead.sponsor_id=? AND ${activeEventSponsorSql("sponsor")}
      AND attempt.action='lead' AND attempt.outcome='eligible' AND ${activeSponsorCaptureSql("attempt")}
      AND (${scopeSql}) ${ownSql})`)
      .bind(
        removedAt,
        removalId,
        leadId,
        eventId,
        sponsorId,
        ...scopeValues,
        ...(scope === "mine" ? [actorUserId] : []),
      ),
    db
      .prepare(`INSERT INTO audit_log(id,actor_type,actor_id,actor_identity_id,action,entity_type,entity_id,details_json,created_at,scope_type,scope_id)
      SELECT ?,'user',?,?,'sponsor_lead_captures_removed','event_sponsor_lead',?,
        json_object('scope',?,'captureCount',(SELECT COUNT(*) FROM event_scan_attempts WHERE sponsor_lead_removal_id=?)),
        ?,'event',?
      WHERE EXISTS (SELECT 1 FROM event_scan_attempts WHERE sponsor_lead_removal_id=?)`)
      .bind(
        removalId,
        actorUserId,
        auditActorIdentityId("user", actorUserId),
        leadId,
        scope,
        removalId,
        removedAt,
        eventId,
        removalId,
      ),
    db
      .prepare(`DELETE FROM event_sponsor_leads WHERE id=? AND event_id=? AND sponsor_id=?
        AND EXISTS (SELECT 1 FROM event_scan_attempts removed WHERE removed.sponsor_lead_removal_id=?)
        AND NOT EXISTS (SELECT 1 FROM event_scan_attempts attempt WHERE attempt.event_id=event_sponsor_leads.event_id
          AND attempt.sponsor_id=event_sponsor_leads.sponsor_id AND attempt.user_id=event_sponsor_leads.user_id
          AND attempt.action='lead' AND attempt.outcome='eligible' AND ${activeSponsorCaptureSql("attempt")})`)
      .bind(leadId, eventId, sponsorId, removalId),
    db
      .prepare(`SELECT
      (SELECT COUNT(*) FROM event_scan_attempts WHERE sponsor_lead_removal_id=?) AS removedCaptures,
      (SELECT COUNT(*) FROM event_scan_attempts attempt
        WHERE attempt.event_id=? AND attempt.sponsor_id=? AND attempt.user_id=(SELECT user_id FROM event_sponsor_leads WHERE id=?)
          AND attempt.action='lead' AND attempt.outcome='eligible' AND ${activeSponsorCaptureSql("attempt")}) AS remainingCaptures`)
      .bind(removalId, eventId, sponsorId, leadId),
  ]);
  const receipt = batchFirst<{ removedCaptures: number; remainingCaptures: number }>(results[3]!);
  if (!receipt?.removedCaptures)
    throw new AppError(404, "LEAD_NOT_FOUND", "Active lead captures not found in your scope.");
  return sponsorLeadRemovalResponseSchema.parse(receipt);
}
