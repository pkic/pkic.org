import {
  batchFirst,
  batchRows,
  buildOffsetPageStatements,
  decodeOffsetPageResults,
  type OffsetPageQuery,
} from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import type { EmailMessageType } from "../../../../assets/shared/schemas/api-common";
import type { EmailOutboxQuery, EmailOutboxStatus } from "../../../../assets/shared/schemas/email-outbox";

export interface OutboxListRow {
  id: string;
  event_id: string | null;
  event_slug: string | null;
  event_name: string | null;
  template_key: string;
  template_version: number | null;
  recipient_email: string;
  subject: string | null;
  payload_json: string;
  message_type: EmailMessageType;
  provider: string;
  provider_message_id: string | null;
  status: EmailOutboxStatus;
  attempts: number;
  send_after: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

interface StatusCountRow {
  status: EmailOutboxStatus;
  count: number;
}

interface MessageTypeCountRow {
  message_type: EmailMessageType;
  count: number;
}

export interface TemplateCountRow {
  template_key: string;
  count: number;
}

export interface EmailOutboxQueryResult {
  rows: OutboxListRow[];
  total: number;
  statusCounts: StatusCountRow[];
  messageTypeCounts: MessageTypeCountRow[];
  templateCounts: TemplateCountRow[];
  dueCounts: StatusCountRow[];
  nextSendAfter: string | null;
}

export interface EmailOutboxQueryStatements {
  page: OffsetPageQuery;
  aggregateFrom: string;
  where: string;
  bindings: readonly unknown[];
}

function buildWhereClause(query: {
  status?: EmailOutboxStatus;
  messageType?: EmailMessageType;
  q?: string;
  dueNow: boolean;
  now: string;
}): {
  where: string;
  bindings: unknown[];
} {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (query.dueNow) {
    conditions.push("o.status IN ('queued', 'retrying')", "o.send_after <= ?");
    bindings.push(query.now);
  }
  if (query.status) {
    conditions.push("o.status = ?");
    bindings.push(query.status);
  }
  if (query.messageType) {
    conditions.push("o.message_type = ?");
    bindings.push(query.messageType);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [
      "o.recipient_email",
      "o.template_key",
      "o.subject",
      "o.last_error",
      "e.slug",
      "e.name",
    ]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", bindings };
}

/**
 * Builds the exact filtered page/count and aggregate source used by the API.
 * Keeping this pure lets D1 EXPLAIN tests inspect production SQL rather than a
 * simplified copy that can drift from the endpoint.
 */
export function buildEmailOutboxQueryStatements(query: EmailOutboxQuery, now: string): EmailOutboxQueryStatements {
  const { where, bindings } = buildWhereClause({ ...query, now });
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      recipient: "o.recipient_email COLLATE NOCASE",
      template: "o.template_key COLLATE NOCASE",
      status: "o.status COLLATE NOCASE",
      sendAfter: "o.send_after",
      createdAt: "o.created_at",
    },
    `CASE o.status
       WHEN 'failed' THEN 0 WHEN 'delivery_unknown' THEN 1 WHEN 'retrying' THEN 2
       WHEN 'queued' THEN 3 WHEN 'sending' THEN 4 ELSE 5
     END ASC, COALESCE(o.sent_at, o.updated_at, o.created_at) DESC`,
    "o.id ASC",
  );
  return {
    page: {
      sql: `SELECT o.id, o.event_id, e.slug AS event_slug, e.name AS event_name,
                 o.template_key, o.template_version, o.recipient_email, o.subject, o.payload_json,
                 o.message_type, o.provider, o.provider_message_id, o.status, o.attempts, o.send_after,
                 o.last_error, o.created_at, o.updated_at, o.sent_at
          FROM email_outbox o
          LEFT JOIN events e ON e.id = o.event_id
          ${where}`,
      bindings,
      orderBy,
      limit: query.limit,
      offset: query.offset,
    },
    aggregateFrom: query.q ? "FROM email_outbox o LEFT JOIN events e ON e.id = o.event_id" : "FROM email_outbox o",
    where,
    bindings,
  };
}

export async function queryEmailOutbox(db: DatabaseLike, query: EmailOutboxQuery): Promise<EmailOutboxQueryResult> {
  const now = new Date().toISOString();
  const statements = buildEmailOutboxQueryStatements(query, now);
  const [pageStatement, countStatement] = buildOffsetPageStatements(db, statements.page);
  const [rowsResult, totalResult, statusResult, messageTypeResult, templateResult, dueResult, dueNextResult] =
    await db.batch([
      pageStatement,
      countStatement,
      db
        .prepare(`SELECT o.status, COUNT(*) AS count ${statements.aggregateFrom} ${statements.where} GROUP BY o.status`)
        .bind(...statements.bindings),
      db
        .prepare(
          `SELECT o.message_type, COUNT(*) AS count ${statements.aggregateFrom} ${statements.where} GROUP BY o.message_type`,
        )
        .bind(...statements.bindings),
      db
        .prepare(
          `SELECT o.template_key, COUNT(*) AS count
           ${statements.aggregateFrom} ${statements.where}
           GROUP BY o.template_key
           ORDER BY count DESC, o.template_key ASC
           LIMIT 5`,
        )
        .bind(...statements.bindings),
      db
        .prepare(
          `SELECT status, COUNT(*) AS count
           FROM email_outbox
           WHERE status IN ('queued', 'retrying') AND send_after <= ?
           GROUP BY status`,
        )
        .bind(now),
      db.prepare(
        `SELECT MIN(send_after) AS send_after
         FROM email_outbox
         WHERE status IN ('queued', 'retrying')`,
      ),
    ]);

  return {
    ...decodeOffsetPageResults<OutboxListRow>(rowsResult, totalResult),
    statusCounts: batchRows<StatusCountRow>(statusResult),
    messageTypeCounts: batchRows<MessageTypeCountRow>(messageTypeResult),
    templateCounts: batchRows<TemplateCountRow>(templateResult),
    dueCounts: batchRows<StatusCountRow>(dueResult),
    nextSendAfter: batchFirst<{ send_after: string | null }>(dueNextResult)?.send_after ?? null,
  };
}
