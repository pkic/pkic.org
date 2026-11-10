import type { EventEmailCampaignPreviewInput } from "../../../../assets/shared/schemas/event-email-campaigns";
import { batchFirst } from "../../db/pagination";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLogWhen } from "../audit";
import { prepareJobWake } from "../scheduled-jobs/dispatcher";
import { campaignPublishedSessions } from "./audience";
import type { CampaignEvent } from "./types";

interface SpeakerKitBatchIdentity {
  batchId: string;
  campaignId: string;
  actorId: string;
  appBaseUrl: string;
  at: string;
}

/** A kit emailed once is not emailed again for that session unless the organizer asks to resend. */
function notEmailedSql(input: EventEmailCampaignPreviewInput) {
  return input.kit?.resend
    ? "1=1"
    : `NOT EXISTS(SELECT 1 FROM event_promotion_batch_recipients emailed
        JOIN event_promotion_batches earlier ON earlier.id=emailed.batch_id AND earlier.email_test=0
        WHERE emailed.occurrence_id=session.occurrence_id AND emailed.user_id=session.user_id AND emailed.email_status='queued')`;
}

function prepareSpeakerKitBatch(
  db: DatabaseLike,
  event: CampaignEvent,
  input: EventEmailCampaignPreviewInput,
  identity: SpeakerKitBatchIdentity,
  options: { test: boolean; condition: { sql: string; bindings: unknown[] } },
) {
  return db
    .prepare(
      `INSERT INTO event_promotion_batches(id,event_id,requested_by,published_revision,formats_json,origin,created_at,email_campaign_id,email_test)
       SELECT ?,state.event_id,?,state.published_revision,?,?,?,?,?
       FROM event_agenda_state state
       WHERE state.event_id=? AND EXISTS(${options.condition.sql})
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      identity.batchId,
      identity.actorId,
      JSON.stringify(input.kit?.formats),
      identity.appBaseUrl,
      identity.at,
      identity.campaignId,
      options.test ? 1 : 0,
      event.id,
      ...options.condition.bindings,
    );
}

/** Commits with the campaign acceptance: one reviewed send becomes one render batch. */
export function prepareSpeakerKitAcceptance(
  db: DatabaseLike,
  event: CampaignEvent,
  input: EventEmailCampaignPreviewInput,
  identity: Omit<SpeakerKitBatchIdentity, "batchId">,
): StatementLike[] {
  const batchId = identity.campaignId;
  const sessions = campaignPublishedSessions(event, input.filter);
  const accepted = {
    sql: "SELECT 1 FROM event_email_campaigns WHERE id=? AND status='complete'",
    bindings: [identity.campaignId],
  };
  return [
    prepareSpeakerKitBatch(db, event, input, { ...identity, batchId }, { test: false, condition: accepted }),
    db
      .prepare(
        `INSERT INTO event_promotion_batch_recipients(batch_id,occurrence_id,user_id,next_attempt_at,updated_at,email_status)
         SELECT ?,session.occurrence_id,session.user_id,?,?,'pending' FROM (${sessions.sql}) session
         WHERE changes()=1 AND session.email IS NOT NULL AND ${notEmailedSql(input)}
         ON CONFLICT(batch_id,occurrence_id,user_id) DO NOTHING`,
      )
      .bind(batchId, identity.at, identity.at, ...sessions.bindings),
    prepareAuditLogWhen(db, {
      actorType: "user",
      actorId: identity.actorId,
      action: "speaker_kit_email_requested",
      entityType: "event",
      entityId: event.id,
      scope: { type: "event", id: event.id },
      details: { batchId, formats: input.kit?.formats ?? [], resend: input.kit?.resend ?? false },
      createdAt: identity.at,
      idempotencyKey: `speaker-kit-email:${batchId}`,
      conditionSql: "SELECT 1 FROM event_promotion_batches WHERE id=?",
      conditionBindings: [batchId],
    }),
    prepareJobWake(db, "promotion_rendering", accepted),
  ];
}

/** Each session and speaker pair is one email, so a two-session speaker counts twice. */
export async function countSpeakerKitEmails(
  db: DatabaseLike,
  event: CampaignEvent,
  input: EventEmailCampaignPreviewInput,
): Promise<number> {
  const sessions = campaignPublishedSessions(event, input.filter);
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM (${sessions.sql}) session WHERE session.email IS NOT NULL AND ${notEmailedSql(input)}`,
    sessions.bindings,
  );
  return row?.total ?? 0;
}

/**
 * Sends the organizer one real speaker's kit. The batch is flagged as a test, so
 * its delivery reaches the organizer and never counts as that speaker's copy.
 */
export async function queueSpeakerKitTest(
  db: DatabaseLike,
  event: CampaignEvent,
  input: EventEmailCampaignPreviewInput,
  identity: { actorId: string; appBaseUrl: string; campaignId: string },
): Promise<{ sessionTitle: string }> {
  const batchId = uuid();
  const at = nowIso();
  const sessions = campaignPublishedSessions(event, input.filter);
  const reviewed = {
    sql: "SELECT 1 FROM event_email_campaigns WHERE id=? AND status='draft' AND expires_at>=?",
    bindings: [identity.campaignId, at],
  };
  const results = await db.batch([
    prepareSpeakerKitBatch(db, event, input, { ...identity, batchId, at }, { test: true, condition: reviewed }),
    db
      .prepare(
        `INSERT INTO event_promotion_batch_recipients(batch_id,occurrence_id,user_id,next_attempt_at,updated_at,email_status)
         SELECT ?,session.occurrence_id,session.user_id,?,?,'pending' FROM (${sessions.sql}) session
         WHERE changes()=1 AND session.email IS NOT NULL
         ORDER BY lower(trim(session.email)),session.occurrence_id LIMIT 1
         ON CONFLICT(batch_id,occurrence_id,user_id) DO NOTHING`,
      )
      .bind(batchId, at, at, ...sessions.bindings),
    prepareJobWake(db, "promotion_rendering", {
      sql: "SELECT 1 FROM event_promotion_batch_recipients WHERE batch_id=?",
      bindings: [batchId],
    }),
    db
      .prepare(
        `SELECT session.session_title FROM (${sessions.sql}) session
         JOIN event_promotion_batch_recipients recipient
           ON recipient.occurrence_id=session.occurrence_id AND recipient.user_id=session.user_id
         WHERE recipient.batch_id=? LIMIT 1`,
      )
      .bind(...sessions.bindings, batchId),
  ]);
  const sample = batchFirst<{ session_title: string }>(results[3]);
  if (!sample) throw new AppError(400, "CAMPAIGN_NO_RECIPIENTS", "No recipients matched the selected filters.");
  return { sessionTitle: sample.session_title };
}
