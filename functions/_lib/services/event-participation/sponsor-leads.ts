import { prepareAttemptCapturedValue } from "./scan-attempt-capture";
import { prepareScanCaptureDecision } from "./scan-capture-decision";
import {
  leadCaptureRequestSchema,
  leadCaptureResponseSchema,
} from "../../../../assets/shared/schemas/event-participation-reporting";
import { batchFirst } from "../../db/pagination";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { eventContactAccessSql } from "./evidence-retention";
import { sponsorConsentSql } from "./sponsor-consent";
import {
  sponsorLeadPermissionSql,
  guardSponsorCaptureDatabase,
  sponsorCaptureAuthorizationEvidence,
} from "./lead-scope";
import { hashBadgeCredential } from "./badge-hash";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import type { EventScanRequest } from "../../../../assets/shared/schemas/event-participation-scanning";
import type { z } from "zod";

/** Canonical transport projection for enrolled and direct sponsor capture paths. */
export function sponsorLeadInput(scan: EventScanRequest) {
  return leadCaptureRequestSchema.parse({
    scannedValue: scan.scannedValue,
    scannedValueTruncated: scan.scannedValueTruncated,
    operatorUserId: scan.operatorUserId,
    operationId: scan.operationId,
    deviceId: scan.deviceId,
    consentConfirmed: true,
    badgeId: scan.badgeId,
    observedAt: scan.observedAt,
    capturePublicationRevision: scan.capturePublicationRevision,
    nativeEventContext: scan.nativeEventContext,
  });
}

export async function prepareSponsorLeadBasis(
  db: DatabaseLike,
  event: EventReadSelection,
  sponsorId: string,
  input: z.infer<typeof leadCaptureRequestSchema>,
) {
  const scope = eventReadIdSql(event);
  const evidence = sponsorCaptureAuthorizationEvidence(input.operatorUserId, sponsorId);
  const capture = prepareScanCaptureDecision(db, event, { ...input, occurrenceId: null, action: "lead", sponsorId });
  return {
    statements: [
      db.prepare(evidence.sql).bind(...evidence.bindings),
      db
        .prepare(
          `SELECT id FROM sponsorships WHERE id=? AND event_id=${scope.sql} AND sponsor_type='event' AND pipeline_stage='active'`,
        )
        .bind(sponsorId, ...scope.bindings),
      db
        .prepare(`SELECT id,user_id FROM event_badge_credentials WHERE event_id=${scope.sql} AND credential_hash=?`)
        .bind(...scope.bindings, await hashBadgeCredential(input.badgeId)),
      ...capture.statements,
    ],
    decode(results: D1StatementResult[], eventId: string) {
      if (!batchFirst(results[0]))
        throw new AppError(403, "LEAD_SCOPE_REQUIRED", "An active sponsor-specific scanning grant is required.");
      if (!batchFirst(results[1]))
        throw new AppError(404, "LEAD_SPONSOR_NOT_FOUND", "Active sponsorship not found in this event.");
      return {
        badge: batchFirst<{ id: string; user_id: string }>(results[2]),
        capture: () => capture.decode(results.slice(3), eventId),
      };
    },
  };
}
type SponsorLeadBasis = ReturnType<Awaited<ReturnType<typeof prepareSponsorLeadBasis>>["decode"]>;

function prepareLeadCaptureAttempt(
  db: DatabaseLike,
  eventId: string,
  sponsorId: string,
  operatorUserId: string,
  operationId: string,
) {
  return db
    .prepare(
      "SELECT request_hash,reason,outcome FROM event_scan_attempts WHERE operation_id=? AND event_id=? AND sponsor_id=? AND operator_user_id=?",
    )
    .bind(operationId, eventId, sponsorId, operatorUserId);
}
function decodeLeadCaptureAttempt(result: D1StatementResult, hash: string) {
  const attempt = batchFirst<{ request_hash: string; reason: string; outcome: string }>(result);
  if (!attempt)
    throw new AppError(403, "LEAD_SCOPE_REQUIRED", "An active sponsor-specific scanning grant is required.");
  if (attempt.request_hash !== hash)
    throw new AppError(409, "SCAN_OPERATION_REUSED", "Use a new operation ID for a different scan.");
  return attempt;
}
/** Explicit sponsor grants and consent are rechecked in the same batch as the immutable attempt. */
export async function captureSponsorLead(
  sourceDb: DatabaseLike,
  eventId: string,
  sponsorId: string,
  operatorUserId: string,
  raw: unknown,
  preparedBasis?: SponsorLeadBasis,
) {
  const input = leadCaptureRequestSchema.parse(raw);
  const db = guardSponsorCaptureDatabase(sourceDb, operatorUserId, sponsorId);
  if (input.operatorUserId !== operatorUserId)
    throw new AppError(403, "SCAN_OPERATOR_CHANGED", "Sign in as the original scanner operator.");
  const read = await prepareSponsorLeadBasis(sourceDb, eventId, sponsorId, input);
  const basis = preparedBasis ?? read.decode(await sourceDb.batch(read.statements), eventId);
  const hash = await hashBadgeCredential(JSON.stringify({ eventId, sponsorId, ...input }));
  const badge = basis.badge;
  const receipt = prepareLeadCaptureAttempt(db, eventId, sponsorId, operatorUserId, input.operationId);
  if (!badge) {
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO event_scan_attempts(id,event_id,sponsor_id,operator_user_id,device_id,operation_id,request_hash,outcome,reason,action,observed_at,created_at,scanned_value,scanned_value_truncated)
      SELECT ?,?,?,?,?,?,?,'unknown','unknown_credential','lead',?,?,?,? FROM sponsorships sponsorship WHERE sponsorship.id=? AND sponsorship.event_id=? AND sponsorship.pipeline_stage='active' AND (${sponsorLeadPermissionSql("agenda:leads_capture")}) ON CONFLICT(operation_id) DO NOTHING`,
        )
        .bind(
          crypto.randomUUID(),
          eventId,
          sponsorId,
          operatorUserId,
          input.deviceId,
          input.operationId,
          hash,
          input.observedAt,
          nowIso(),
          input.scannedValue,
          input.scannedValueTruncated ? 1 : 0,
          sponsorId,
          eventId,
          operatorUserId,
          sponsorId,
          operatorUserId,
          sponsorId,
        ),
      receipt,
    ]);
    decodeLeadCaptureAttempt(results[results.length - 1], hash);
    return leadCaptureResponseSchema.parse({ captured: false, recorded: true, reason: "unknown_credential" });
  }
  const capture = basis.capture();
  const permission = sponsorLeadPermissionSql("agenda:leads_capture");
  const consent = sponsorConsentSql("reg");
  const id = crypto.randomUUID();
  const results = await db.batch([
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
    prepareAttemptCapturedValue(db, eventId, input, hash),
    receipt,
  ]);
  const attempt = decodeLeadCaptureAttempt(results[results.length - 1], hash);
  return leadCaptureResponseSchema.parse({
    captured: attempt.outcome === "eligible",
    recorded: true,
    reason: attempt.outcome === "eligible" ? "captured" : attempt.reason,
  });
}
