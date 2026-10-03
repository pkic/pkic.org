import {
  leadCaptureRequestSchema,
  leadCaptureResponseSchema,
} from "../../../../assets/shared/schemas/event-participation-reporting";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { sponsorConsentSql } from "./sponsor-consent";
import { hashBadgeCredential } from "./scanning";
/** Explicit sponsor grants and consent are rechecked in the same batch as the immutable attempt. */
export async function captureSponsorLead(
  db: DatabaseLike,
  eventId: string,
  sponsorId: string,
  operatorUserId: string,
  raw: unknown,
) {
  const input = leadCaptureRequestSchema.parse(raw);
  if (input.operatorUserId !== operatorUserId)
    throw new AppError(403, "SCAN_OPERATOR_CHANGED", "Sign in as the original scanner operator.");
  if (
    !(await first(
      db,
      "SELECT id FROM sponsorships WHERE id=? AND event_id=? AND sponsor_type='event' AND pipeline_stage='active'",
      [sponsorId, eventId],
    ))
  )
    throw new AppError(404, "LEAD_SPONSOR_NOT_FOUND", "Active sponsorship not found in this event.");
  const hash = await hashBadgeCredential(JSON.stringify({ eventId, sponsorId, ...input }));
  const badge = await first<{ id: string; user_id: string }>(
    db,
    "SELECT id,user_id FROM event_badge_credentials WHERE event_id=? AND credential_hash=?",
    [eventId, await hashBadgeCredential(input.badgeId)],
  );
  if (!badge)
    return leadCaptureResponseSchema.parse({ captured: false, recorded: false, reason: "unknown_credential" });
  const permission =
    "EXISTS(SELECT 1 FROM permission_grants g JOIN users u ON u.id=g.user_id WHERE g.user_id=? AND u.active=1 AND g.permission='agenda:leads_capture' AND g.context_type='event_sponsor' AND g.context_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))) OR EXISTS(SELECT 1 FROM user_roles role JOIN role_permissions rp ON rp.role_id=role.role_id JOIN users u ON u.id=role.user_id WHERE role.user_id=? AND u.active=1 AND role.member_id IS NULL AND rp.permission='agenda:leads_capture' AND role.context_type='event_sponsor' AND role.context_id=? AND role.revoked_at IS NULL AND (role.expires_at IS NULL OR role.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))";
  const consent = sponsorConsentSql("reg");
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO event_scan_attempts (id,event_id,sponsor_id,badge_id,user_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,action,observed_at,created_at)
   SELECT ?,b.event_id,?,b.id,b.user_id,?,?,?,?,CASE WHEN b.revoked_at IS NOT NULL OR COALESCE(reg.status,'')<>'registered' THEN 'denied' WHEN ${consent} THEN 'eligible' ELSE 'warning' END,
   CASE WHEN b.revoked_at IS NOT NULL THEN 'revoked_badge' WHEN COALESCE(reg.status,'')<>'registered' THEN 'missing_registration' WHEN ${consent} THEN 'eligible' ELSE 'consent_required' END,'lead',?,?
   FROM event_badge_credentials b LEFT JOIN registrations reg ON reg.event_id=b.event_id AND reg.user_id=b.user_id
   WHERE b.id=? AND b.event_id=? AND (${permission}) AND EXISTS(SELECT 1 FROM sponsorships sp WHERE sp.id=? AND sp.event_id=b.event_id AND sp.pipeline_stage='active')
   ON CONFLICT(operation_id) DO NOTHING`,
      )
      .bind(
        id,
        sponsorId,
        operatorUserId,
        input.deviceId,
        input.operationId,
        hash,
        input.observedAt,
        nowIso(),
        badge.id,
        eventId,
        operatorUserId,
        sponsorId,
        operatorUserId,
        sponsorId,
        sponsorId,
      ),
    db
      .prepare(
        `INSERT INTO event_sponsor_leads (id,event_id,sponsor_id,user_id,operator_user_id,observed_at)
    SELECT ?,event_id,sponsor_id,user_id,operator_user_id,observed_at FROM event_scan_attempts WHERE id=? AND outcome='eligible'
    ON CONFLICT(event_id,sponsor_id,user_id) DO UPDATE SET operator_user_id=CASE WHEN excluded.observed_at<event_sponsor_leads.observed_at THEN excluded.operator_user_id ELSE event_sponsor_leads.operator_user_id END,observed_at=MIN(event_sponsor_leads.observed_at,excluded.observed_at)`,
      )
      .bind(crypto.randomUUID(), id),
  ]);
  const attempt = await first<{ request_hash: string; reason: string; outcome: string }>(
    db,
    "SELECT request_hash,reason,outcome FROM event_scan_attempts WHERE operation_id=? AND event_id=? AND sponsor_id=? AND operator_user_id=?",
    [input.operationId, eventId, sponsorId, operatorUserId],
  );
  if (!attempt)
    throw new AppError(403, "LEAD_SCOPE_REQUIRED", "An active sponsor-specific scanning grant is required.");
  if (attempt.request_hash !== hash)
    throw new AppError(409, "SCAN_OPERATION_REUSED", "Use a new operation ID for a different scan.");
  return leadCaptureResponseSchema.parse({
    captured: attempt.outcome === "eligible",
    recorded: true,
    reason: attempt.outcome === "eligible" ? "captured" : attempt.reason,
  });
}
