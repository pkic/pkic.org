import { scanCaptureDecision } from "./scan-capture-decision";
import {
  leadCaptureRequestSchema,
  leadCaptureResponseSchema,
} from "../../../../assets/shared/schemas/event-participation-reporting";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { eventContactAccessSql } from "./evidence-retention";
import { sponsorConsentSql } from "./sponsor-consent";
import { sponsorLeadPermissionSql } from "./lead-scope";
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
  const capture = await scanCaptureDecision(db, eventId, { ...input, occurrenceId: null, action: "lead", sponsorId });
  const permission = sponsorLeadPermissionSql("agenda:leads_capture");
  const consent = sponsorConsentSql("reg");
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO event_scan_attempts (id,event_id,sponsor_id,badge_id,user_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,action,observed_at,created_at,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source)
   SELECT ?,b.event_id,?,b.id,b.user_id,?,?,?,?,CASE WHEN NOT (${capture.sql}) THEN 'unverified' WHEN b.revoked_at IS NOT NULL OR (b.expires_at IS NOT NULL AND b.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR COALESCE(reg.status,'')<>'registered' THEN 'denied' WHEN NOT (${eventContactAccessSql("b.event_id")}) THEN 'denied' WHEN ${consent} THEN 'eligible' ELSE 'warning' END,
   CASE WHEN NOT (${capture.sql}) THEN 'verification_required' WHEN b.revoked_at IS NOT NULL THEN 'revoked_badge' WHEN b.expires_at IS NOT NULL AND b.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'expired_badge' WHEN COALESCE(reg.status,'')<>'registered' THEN 'missing_registration' WHEN NOT (${eventContactAccessSql("b.event_id")}) THEN 'contact_retention_expired' WHEN ${consent} THEN 'eligible' ELSE 'consent_required' END,'lead',?,?,?,?,?,?
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
        ...capture.bindings,
        ...capture.bindings,
        input.observedAt,
        nowIso(),
        ...capture.values,
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
    SELECT ?,event_id,sponsor_id,user_id,operator_user_id,observed_at FROM event_scan_attempts WHERE id=? AND outcome='eligible' AND ${eventContactAccessSql("event_scan_attempts.event_id")}
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
