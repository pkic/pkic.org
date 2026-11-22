import { sponsorLeadRemovalResponseSchema } from "../../../../assets/shared/schemas/event-sponsor-lead-list";
import { batchFirst } from "../../db/pagination";
import type { DatabaseLike } from "../../db/types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { auditActorIdentityId } from "../audit-actor";
import { activeEventSponsorSql, sponsorLeadViewerPredicateSql } from "../../auth/sponsor-organization-lead-access";
import { sponsorLeadPermissionBindings, sponsorLeadPermissionSql } from "./lead-scope";
import { activeSponsorCaptureSql } from "./sponsor-lead-active";

/** Records withdrawals without editing scan evidence, including after evidence capture closes. */
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
      .prepare(`INSERT INTO event_sponsor_lead_removed_attempts(attempt_id,lead_id,removal_id,removed_by_user_id,removed_at)
      SELECT attempt.id,lead.id,?,?,? FROM event_scan_attempts attempt
      JOIN event_sponsor_leads lead ON lead.event_id=attempt.event_id AND lead.sponsor_id=attempt.sponsor_id AND lead.user_id=attempt.user_id
      JOIN sponsorships sponsor ON sponsor.id=lead.sponsor_id AND sponsor.event_id=lead.event_id
      WHERE lead.id=? AND lead.event_id=? AND lead.sponsor_id=? AND ${activeEventSponsorSql("sponsor")}
      AND attempt.action='lead' AND attempt.outcome='eligible' AND ${activeSponsorCaptureSql("attempt")}
      AND (${scopeSql}) ${ownSql}
      ON CONFLICT(attempt_id) DO NOTHING`)
      .bind(
        removalId,
        actorUserId,
        removedAt,
        leadId,
        eventId,
        sponsorId,
        ...scopeValues,
        ...(scope === "mine" ? [actorUserId] : []),
      ),
    db
      .prepare(`INSERT INTO audit_log(id,actor_type,actor_id,actor_identity_id,action,entity_type,entity_id,details_json,created_at,scope_type,scope_id)
      SELECT ?,'user',?,?,'sponsor_lead_captures_removed','event_sponsor_lead',?,
        json_object('scope',?,'captureCount',(SELECT COUNT(*) FROM event_sponsor_lead_removed_attempts WHERE removal_id=?)),
        ?,'event',?
      WHERE EXISTS (SELECT 1 FROM event_sponsor_lead_removed_attempts WHERE removal_id=?)`)
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
      .prepare(`SELECT
      (SELECT COUNT(*) FROM event_sponsor_lead_removed_attempts WHERE removal_id=?) AS removedCaptures,
      (SELECT COUNT(*) FROM event_scan_attempts attempt
        WHERE attempt.event_id=? AND attempt.sponsor_id=? AND attempt.user_id=(SELECT user_id FROM event_sponsor_leads WHERE id=?)
          AND attempt.action='lead' AND attempt.outcome='eligible' AND ${activeSponsorCaptureSql("attempt")}) AS remainingCaptures`)
      .bind(removalId, eventId, sponsorId, leadId),
  ]);
  const receipt = batchFirst<{ removedCaptures: number; remainingCaptures: number }>(results[2]!);
  if (!receipt?.removedCaptures)
    throw new AppError(404, "LEAD_NOT_FOUND", "Active lead captures not found in your scope.");
  return sponsorLeadRemovalResponseSchema.parse(receipt);
}
