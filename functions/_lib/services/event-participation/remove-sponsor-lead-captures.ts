import { sponsorLeadRemovalResponseSchema } from "../../../../assets/shared/schemas/event-sponsor-lead-list";
import { batchFirst } from "../../db/pagination";
import type { DatabaseLike } from "../../db/types";
import type { UserBackedAuthAdmin } from "../../types";
import { guardPermissionDatabase } from "../../auth/permissions";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { auditActorIdentityId } from "../audit-actor";
import { activeEventSponsorSql, sponsorLeadViewerPredicateSql } from "../../auth/sponsor-organization-lead-access";
import { sponsorLeadPermissionBindings, sponsorLeadPermissionSql } from "./lead-scope";
import { activeSponsorCaptureSql } from "./sponsor-lead-active";

/** Clears selected lead scans and refreshes the shared lead in one guarded command. */
export async function removeSponsorLeadCaptures(
  sourceDb: DatabaseLike,
  eventId: string,
  sponsorId: string,
  leadId: string,
  actor: UserBackedAuthAdmin,
  scope: "mine" | "all",
) {
  if (!actor.sessionId || actor.scopeRestricted)
    throw new AppError(403, "HUMAN_SESSION_REQUIRED", "Sign in to the event app to remove lead captures.");
  const actorUserId = actor.id;
  const db = guardPermissionDatabase(
    sourceDb,
    actor,
    [
      {
        permission: scope === "all" ? "agenda:leads_view" : "agenda:leads_capture",
        context: { type: "event_sponsor", id: sponsorId },
      },
    ],
    () => new AppError(404, "LEAD_NOT_FOUND", "Active lead captures not found in your scope."),
  );
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
      .prepare(`INSERT INTO event_sponsor_lead_removal_permits (target_table,target_id,removal_id)
      SELECT 'event_scan_attempts',attempt.id,? FROM event_scan_attempts attempt
      JOIN event_sponsor_leads lead ON lead.event_id=attempt.event_id AND lead.sponsor_id=attempt.sponsor_id AND lead.user_id=attempt.user_id
      JOIN sponsorships sponsor ON sponsor.id=lead.sponsor_id AND sponsor.event_id=lead.event_id
      WHERE lead.id=? AND lead.event_id=? AND lead.sponsor_id=? AND ${activeEventSponsorSql("sponsor")}
      AND attempt.action='lead' AND attempt.outcome='eligible' AND ${activeSponsorCaptureSql("attempt")}
      AND (${scopeSql}) ${ownSql}`)
      .bind(removalId, leadId, eventId, sponsorId, ...scopeValues, ...(scope === "mine" ? [actorUserId] : [])),
    db
      .prepare(`UPDATE event_scan_attempts SET sponsor_lead_removed_at=?,sponsor_lead_removal_id=?,
        user_id=NULL,badge_id=NULL,scanned_value=NULL,scanned_value_truncated=NULL,
        request_hash=lower(hex(randomblob(32)))
      WHERE id IN (SELECT target_id FROM event_sponsor_lead_removal_permits
        WHERE removal_id=? AND target_table='event_scan_attempts')`)
      .bind(removedAt, removalId, removalId),
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
      .prepare(`INSERT INTO event_sponsor_lead_removal_permits (target_table,target_id,removal_id)
      SELECT 'event_sponsor_leads',id,? FROM event_sponsor_leads WHERE id=? AND event_id=? AND sponsor_id=?
        AND EXISTS (SELECT 1 FROM event_scan_attempts removed WHERE removed.sponsor_lead_removal_id=?)
        AND NOT EXISTS (SELECT 1 FROM event_scan_attempts attempt WHERE attempt.event_id=event_sponsor_leads.event_id
          AND attempt.sponsor_id=event_sponsor_leads.sponsor_id AND attempt.user_id=event_sponsor_leads.user_id
          AND attempt.action='lead' AND attempt.outcome='eligible' AND ${activeSponsorCaptureSql("attempt")})`)
      .bind(removalId, leadId, eventId, sponsorId, removalId),
    db
      .prepare(`DELETE FROM event_sponsor_leads WHERE id IN (SELECT target_id
        FROM event_sponsor_lead_removal_permits WHERE removal_id=? AND target_table='event_sponsor_leads')`)
      .bind(removalId),
    db.prepare("DELETE FROM event_sponsor_lead_removal_permits WHERE removal_id=?").bind(removalId),
    db
      .prepare("SELECT COUNT(*) AS removedCaptures FROM event_scan_attempts WHERE sponsor_lead_removal_id=?")
      .bind(removalId),
  ]);
  const receipt = batchFirst<{ removedCaptures: number }>(results.at(-1)!);
  if (!receipt?.removedCaptures)
    throw new AppError(404, "LEAD_NOT_FOUND", "Active lead captures not found in your scope.");
  return sponsorLeadRemovalResponseSchema.parse(receipt);
}
