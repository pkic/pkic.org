import type { SendgridEvent } from "../../../../assets/shared/schemas/route-contracts-webhooks";
import { chunkJsonRows } from "../../db/json-bulk";
import { logInfo } from "../../logging";
import type { Env } from "../../types";
import { stringifyJson } from "../../utils/json";
import { normalizeOrigin, isLoopbackOrigin } from "./signature";

const EVENT_ACTIONS: Readonly<Record<string, string>> = {
  bounce: "email_hard_bounce",
  deferred: "email_deferred",
  dropped: "email_dropped",
  spamreport: "email_spam_report",
  unsubscribe: "email_unsubscribe",
  group_unsubscribe: "email_unsubscribe",
  delivered: "email_delivered",
};

interface NormalizedSendgridEvent {
  baseId: string;
  eventType: string;
  action: string;
  sequence: number;
  hardFailure: number;
  delivered: number;
  registrationFailure: number;
  errorText: string | null;
  email: string | null;
  unsubscribeChannel: string | null;
  unsubscribeReason: string | null;
  detailsJson: string;
  occurredAt: string;
  idempotencyKey: string;
}

function extractBaseMessageId(sendgridMessageId: string): string {
  const dotIndex = sendgridMessageId.indexOf(".");
  return dotIndex === -1 ? sendgridMessageId : sendgridMessageId.slice(0, dotIndex);
}

function eventReason(event: SendgridEvent): string {
  return event.reason ?? event.response ?? event.status ?? "no reason given";
}

function normalizeEvent(event: SendgridEvent, sequence: number): NormalizedSendgridEvent | null {
  const action = EVENT_ACTIONS[event.event];
  if (!action || !event.sg_message_id) return null;
  const baseId = extractBaseMessageId(event.sg_message_id);
  const hardFailure =
    event.event === "dropped" || event.event === "spamreport" || (event.event === "bounce" && event.type !== "soft");
  const softFailure = event.event === "deferred" || (event.event === "bounce" && event.type === "soft");
  const reason = eventReason(event);
  const errorText =
    event.event === "spamreport"
      ? "Spam report received"
      : event.event === "dropped"
        ? `Dropped: ${reason}`
        : event.event === "deferred"
          ? `Delivery deferred: ${reason}`
          : event.event === "bounce"
            ? `${hardFailure ? "Hard" : "Soft"} bounce: ${reason}`
            : null;
  const unsubscribeChannel =
    event.event === "spamreport" || event.event === "unsubscribe"
      ? "email"
      : event.event === "group_unsubscribe" && event.asm_group_id
        ? `email_group_${event.asm_group_id}`
        : null;
  const occurredAt = event.timestamp ? new Date(event.timestamp * 1000).toISOString() : new Date().toISOString();
  const eventIdentity =
    event.sg_event_id ??
    [
      baseId,
      event.event,
      event.timestamp ?? "no-time",
      event.email ?? "no-email",
      event.asm_group_id ?? "no-group",
    ].join(":");

  return {
    baseId,
    eventType: event.event,
    action: event.event === "bounce" && !hardFailure ? "email_soft_bounce" : action,
    sequence,
    hardFailure: hardFailure ? 1 : 0,
    delivered: event.event === "delivered" ? 1 : 0,
    registrationFailure: hardFailure ? 1 : 0,
    errorText: hardFailure || softFailure ? errorText : null,
    email: event.email ?? null,
    unsubscribeChannel,
    unsubscribeReason: event.event === "spamreport" ? "spam_report" : unsubscribeChannel ? "unsubscribed" : null,
    detailsJson: stringifyJson({ email: event.email ?? null, reason, baseId, channel: unsubscribeChannel }),
    occurredAt,
    idempotencyKey: `sendgrid:${eventIdentity}`,
  };
}

const JSON_EVENT_ROWS = `
  SELECT
    json_extract(value, '$.baseId') AS base_id,
    json_extract(value, '$.eventType') AS event_type,
    json_extract(value, '$.action') AS action,
    CAST(json_extract(value, '$.sequence') AS INTEGER) AS sequence,
    CAST(json_extract(value, '$.hardFailure') AS INTEGER) AS hard_failure,
    CAST(json_extract(value, '$.delivered') AS INTEGER) AS delivered,
    CAST(json_extract(value, '$.registrationFailure') AS INTEGER) AS registration_failure,
    json_extract(value, '$.errorText') AS error_text,
    json_extract(value, '$.email') AS email,
    json_extract(value, '$.unsubscribeChannel') AS unsubscribe_channel,
    json_extract(value, '$.unsubscribeReason') AS unsubscribe_reason,
    json_extract(value, '$.detailsJson') AS details_json,
    json_extract(value, '$.occurredAt') AS occurred_at,
    json_extract(value, '$.idempotencyKey') AS idempotency_key
  FROM json_each(?)
`;

function prepareEventBatchStatements(env: Env, jsonRows: string) {
  const updateOutbox = env.DB.prepare(
    `WITH event_rows AS (${JSON_EVENT_ROWS}),
     rollup AS (
       SELECT base_id,
              MAX(hard_failure) AS hard_failure,
              MAX(delivered) AS delivered,
              COALESCE(
                (SELECT error_text FROM event_rows latest_hard
                 WHERE latest_hard.base_id = grouped.base_id AND latest_hard.hard_failure = 1
                 ORDER BY latest_hard.sequence DESC LIMIT 1),
                (SELECT error_text FROM event_rows latest_error
                 WHERE latest_error.base_id = grouped.base_id AND latest_error.error_text IS NOT NULL
                 ORDER BY latest_error.sequence DESC LIMIT 1)
              ) AS final_error
       FROM event_rows grouped
       WHERE hard_failure = 1 OR delivered = 1 OR error_text IS NOT NULL
       GROUP BY base_id
     )
     UPDATE email_outbox
     SET status = CASE
           WHEN (SELECT hard_failure FROM rollup WHERE base_id = provider_message_id) = 1 THEN 'bounced'
           WHEN (SELECT delivered FROM rollup WHERE base_id = provider_message_id) = 1 AND status = 'sent' THEN 'delivered'
           ELSE status
         END,
         last_error = COALESCE((SELECT final_error FROM rollup WHERE base_id = provider_message_id), last_error),
         updated_at = datetime('now')
     WHERE provider_message_id IN (SELECT base_id FROM rollup)`,
  ).bind(jsonRows);

  const insertUnsubscribes = env.DB.prepare(
    `WITH event_rows AS (${JSON_EVENT_ROWS})
     INSERT OR IGNORE INTO unsubscribes (id, email, channel, scope_type, scope_ref, reason, created_at)
     SELECT lower(hex(randomblob(16))), lower(email), unsubscribe_channel, 'global', NULL,
            MIN(unsubscribe_reason), MIN(occurred_at)
     FROM event_rows
     WHERE email IS NOT NULL AND unsubscribe_channel IS NOT NULL
     GROUP BY lower(email), unsubscribe_channel`,
  ).bind(jsonRows);

  const insertOutboxAudits = env.DB.prepare(
    `WITH event_rows AS (${JSON_EVENT_ROWS})
     INSERT OR IGNORE INTO audit_log
       (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, idempotency_key)
     SELECT lower(hex(randomblob(16))), 'system', NULL, event_rows.action, 'email_outbox', email_outbox.id,
            event_rows.details_json, event_rows.occurred_at, event_rows.idempotency_key
     FROM event_rows
     JOIN email_outbox ON email_outbox.provider_message_id = event_rows.base_id`,
  ).bind(jsonRows);

  const insertRegistrationAudits = env.DB.prepare(
    `WITH event_rows AS (${JSON_EVENT_ROWS})
     INSERT OR IGNORE INTO audit_log
       (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at, idempotency_key)
     SELECT lower(hex(randomblob(16))), 'system', NULL, 'registration_confirmation_delivery_failed',
            'registration', registrations.id, event_rows.details_json, event_rows.occurred_at,
            event_rows.idempotency_key || ':registration:' || registrations.id
     FROM event_rows
     JOIN email_outbox ON email_outbox.provider_message_id = event_rows.base_id
     JOIN registrations ON registrations.event_id = email_outbox.event_id
                       AND registrations.user_id = email_outbox.recipient_user_id
                       AND registrations.status = 'pending_email_confirmation'
     WHERE event_rows.registration_failure = 1`,
  ).bind(jsonRows);

  return [updateOutbox, insertUnsubscribes, insertOutboxAudits, insertRegistrationAudits];
}

export async function processSendgridEvents(
  env: Env,
  events: SendgridEvent[],
): Promise<{ processed: number; ignored: number }> {
  const expectedOrigin = normalizeOrigin(env.APP_BASE_URL);
  const enforceEnvironment = Boolean(expectedOrigin && !isLoopbackOrigin(expectedOrigin));
  const normalized: NormalizedSendgridEvent[] = [];
  let ignored = 0;

  for (const [sequence, event] of events.entries()) {
    const eventOrigin = normalizeOrigin(event.env_url);
    if (enforceEnvironment && eventOrigin !== expectedOrigin) {
      ignored += 1;
      logInfo("SENDGRID_EVENT_SKIPPED_ENV", {
        eventType: event.event,
        env_url: event.env_url,
        expected: env.APP_BASE_URL,
      });
      continue;
    }
    const row = normalizeEvent(event, sequence);
    if (row) normalized.push(row);
    else ignored += 1;
  }

  for (const chunk of chunkJsonRows(normalized)) {
    await env.DB.batch(prepareEventBatchStatements(env, chunk.json));
  }
  return { processed: normalized.length, ignored };
}
