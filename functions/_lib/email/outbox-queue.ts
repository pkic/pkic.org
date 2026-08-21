import { run } from "../db/queries";
import { chunkJsonRows } from "../db/json-bulk";
import { authorizeQueuedCapabilityLinks } from "../auth/capability-links";
import type { DatabaseLike, StatementLike } from "../types";
import { uuid } from "../utils/ids";
import { stringifyJson } from "../utils/json";
import { nowIso } from "../utils/time";
import type { QueuedEmailAttachment } from "./attachments";
import type { EmailMessageType } from "../../../assets/shared/schemas/admin-email-templates";

export interface CalendarPayload {
  registrationId: string;
  eventId: string;
  icsUid: string;
  icsFiles: Array<{ uid: string; filename: string; content: string }>;
  inlineContent?: string;
}

export interface QueueEmailPayload {
  /** Stable database id required together with idempotencyKey. */
  outboxId?: string;
  /** Stable domain-operation key for exactly-once durable enqueueing. */
  idempotencyKey?: string;
  eventId?: string | null;
  baseUrl?: string;
  templateKey: string;
  recipientUserId?: string | null;
  recipientEmail: string;
  subject?: string | null;
  data: Record<string, unknown>;
  capabilityLinkValues?: unknown[];
  messageType: EmailMessageType;
  calendar?: CalendarPayload;
  attachments?: QueuedEmailAttachment[];
  replyTo?: string;
  bounceAddress?: string;
  sendAfterSeconds?: number;
}

const EMAIL_OUTBOX_COLUMNS = `id, event_id, template_key, template_version, recipient_user_id, recipient_email,
  subject, payload_json, message_type, provider, provider_message_id, status, attempts,
  send_after, last_error, created_at, updated_at, sent_at, idempotency_key`;
const EMAIL_OUTBOX_VALUE_EXPRESSIONS =
  "?, ?, ?, NULL, ?, ?, ?, ?, ?, 'sendgrid', NULL, 'queued', 0, ?, NULL, ?, ?, NULL, ?";
const EMAIL_OUTBOX_CONFLICT_SQL = "ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING";
const EMAIL_OUTBOX_INSERT_SQL = `INSERT INTO email_outbox (${EMAIL_OUTBOX_COLUMNS})
  VALUES (${EMAIL_OUTBOX_VALUE_EXPRESSIONS}) ${EMAIL_OUTBOX_CONFLICT_SQL}`;

const BULK_EMAIL_OUTBOX_INSERT_SQL = `INSERT INTO email_outbox (
      id, event_id, template_key, template_version, recipient_user_id, recipient_email,
      subject, payload_json, message_type, provider, provider_message_id, status, attempts,
      send_after, last_error, created_at, updated_at, sent_at, idempotency_key
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.eventId'),
      json_extract(value, '$.templateKey'),
      NULL,
      json_extract(value, '$.recipientUserId'),
      json_extract(value, '$.recipientEmail'),
      json_extract(value, '$.subject'),
      json_extract(value, '$.payloadJson'),
      json_extract(value, '$.messageType'),
      'sendgrid', NULL, 'queued', 0,
      json_extract(value, '$.sendAfter'),
      NULL,
      json_extract(value, '$.queuedAt'),
      json_extract(value, '$.queuedAt'),
      NULL, NULL
    FROM json_each(?)
    WHERE json_extract(value, '$.requiredInviteId') IS NULL
       OR EXISTS (
         SELECT 1 FROM invites
         WHERE invites.id = json_extract(value, '$.requiredInviteId')
       )`;

function buildEmailOutboxValues(payload: QueueEmailPayload, id: string, queuedAt: string): unknown[] {
  const data = { ...payload.data } as Record<string, unknown>;
  if (payload.baseUrl) data.__baseUrl = payload.baseUrl;
  if (payload.calendar) data.__calendarInvite = payload.calendar;
  if (payload.attachments?.length) data.__attachments = payload.attachments;
  if (payload.replyTo) data.__replyTo = payload.replyTo;
  if (payload.bounceAddress) data.__bounceAddress = payload.bounceAddress;
  const storedData = authorizeQueuedCapabilityLinks(data, payload.capabilityLinkValues ?? []);
  const sendAfter =
    payload.sendAfterSeconds && payload.sendAfterSeconds > 0
      ? new Date(Date.now() + payload.sendAfterSeconds * 1000).toISOString()
      : queuedAt;
  return [
    id,
    payload.eventId ?? null,
    payload.templateKey,
    payload.recipientUserId ?? null,
    payload.recipientEmail,
    payload.subject ?? null,
    stringifyJson(storedData),
    payload.messageType,
    sendAfter,
    queuedAt,
    queuedAt,
    payload.idempotencyKey ?? null,
  ];
}

function resolveOutboxId(payload: QueueEmailPayload): string {
  if (payload.idempotencyKey && !payload.outboxId) {
    throw new Error("QueueEmailPayload.outboxId is required when idempotencyKey is set");
  }
  return payload.outboxId ?? uuid();
}

export async function queueEmail(db: DatabaseLike, payload: QueueEmailPayload): Promise<string> {
  const id = resolveOutboxId(payload);
  await run(db, EMAIL_OUTBOX_INSERT_SQL, buildEmailOutboxValues(payload, id, nowIso()));
  return id;
}

export function prepareQueueEmailStatement(
  db: DatabaseLike,
  payload: QueueEmailPayload,
  queuedAt = nowIso(),
): { id: string; statement: StatementLike } {
  const id = resolveOutboxId(payload);
  return { id, statement: db.prepare(EMAIL_OUTBOX_INSERT_SQL).bind(...buildEmailOutboxValues(payload, id, queuedAt)) };
}

/** Builds an outbox INSERT guarded by a fixed caller-owned database predicate. */
export function prepareQueueEmailStatementWhen(
  db: DatabaseLike,
  payload: QueueEmailPayload,
  condition: { sql: string; bindings: unknown[] },
  queuedAt = nowIso(),
): { id: string; statement: StatementLike } {
  const id = resolveOutboxId(payload);
  const values = buildEmailOutboxValues(payload, id, queuedAt);
  return {
    id,
    statement: db
      .prepare(
        `INSERT INTO email_outbox (${EMAIL_OUTBOX_COLUMNS})
         SELECT ${EMAIL_OUTBOX_VALUE_EXPRESSIONS}
         WHERE EXISTS (${condition.sql})
         ${EMAIL_OUTBOX_CONFLICT_SQL}`,
      )
      .bind(...values, ...condition.bindings),
  };
}

export interface BulkEmailQueueRow {
  eventId: string;
  recipientEmail: string;
  recipientUserId?: string | null;
  templateKey: string;
  subject: string;
  data: Record<string, unknown>;
  capabilityLinkValues?: unknown[];
  messageType: EmailMessageType;
  /** Only insert this outbox row if the same D1 batch inserted this invite. */
  requiredInviteId?: string;
}

export interface PreparedBulkEmailQueueRow {
  id: string;
  statement: StatementLike;
}

export interface PreparedBulkEmailQueueChunk {
  ids: string[];
  statement: StatementLike;
}

interface SerializedBulkEmailQueueRow {
  id: string;
  eventId: string;
  templateKey: string;
  recipientUserId: string | null;
  recipientEmail: string;
  subject: string;
  payloadJson: string;
  messageType: EmailMessageType;
  sendAfter: string;
  queuedAt: string;
  requiredInviteId: string | null;
}

function serializeBulkEmailQueueRow(row: BulkEmailQueueRow, queuedAt: string): SerializedBulkEmailQueueRow {
  return {
    id: uuid(),
    eventId: row.eventId,
    templateKey: row.templateKey,
    recipientUserId: row.recipientUserId ?? null,
    recipientEmail: row.recipientEmail,
    subject: row.subject,
    payloadJson: stringifyJson(authorizeQueuedCapabilityLinks(row.data, row.capabilityLinkValues ?? [])),
    messageType: row.messageType,
    sendAfter: queuedAt,
    queuedAt,
    requiredInviteId: row.requiredInviteId ?? null,
  };
}

/**
 * Prepares D1-efficient multi-row outbox inserts. Each returned statement
 * inserts a bounded JSON chunk instead of consuming one D1 query per email.
 */
export function prepareBulkQueueEmailChunkStatements(
  db: DatabaseLike,
  rows: BulkEmailQueueRow[],
  queuedAt = nowIso(),
): PreparedBulkEmailQueueChunk[] {
  const serializedRows = rows.map((row) => serializeBulkEmailQueueRow(row, queuedAt));
  return chunkJsonRows(serializedRows).map((chunk) => ({
    ids: chunk.rows.map((row) => row.id),
    statement: db.prepare(BULK_EMAIL_OUTBOX_INSERT_SQL).bind(chunk.json),
  }));
}

export function prepareBulkQueueEmailStatements(
  db: DatabaseLike,
  rows: BulkEmailQueueRow[],
  queuedAt = nowIso(),
): PreparedBulkEmailQueueRow[] {
  return rows.map((row) => {
    const id = uuid();
    return {
      id,
      statement: db
        .prepare(EMAIL_OUTBOX_INSERT_SQL)
        .bind(
          id,
          row.eventId,
          row.templateKey,
          row.recipientUserId ?? null,
          row.recipientEmail,
          row.subject,
          stringifyJson(authorizeQueuedCapabilityLinks(row.data, row.capabilityLinkValues ?? [])),
          row.messageType,
          queuedAt,
          queuedAt,
          queuedAt,
          null,
        ),
    };
  });
}

export type InviteEmailQueueRow = Omit<BulkEmailQueueRow, "messageType">;

export function prepareBulkQueueInviteEmailStatements(
  db: DatabaseLike,
  rows: InviteEmailQueueRow[],
  queuedAt = nowIso(),
): StatementLike[] {
  return prepareBulkQueueEmailStatements(
    db,
    rows.map((row) => ({ ...row, messageType: "transactional" as const })),
    queuedAt,
  ).map((row) => row.statement);
}

export function prepareBulkQueueInviteEmailChunkStatements(
  db: DatabaseLike,
  rows: InviteEmailQueueRow[],
  queuedAt = nowIso(),
): PreparedBulkEmailQueueChunk[] {
  return prepareBulkQueueEmailChunkStatements(
    db,
    rows.map((row) => ({ ...row, messageType: "transactional" as const })),
    queuedAt,
  );
}

export async function bulkQueueInviteEmails(db: DatabaseLike, rows: InviteEmailQueueRow[]): Promise<void> {
  const statements = prepareBulkQueueInviteEmailChunkStatements(db, rows).map((chunk) => chunk.statement);
  if (statements.length > 0) await db.batch(statements);
}
