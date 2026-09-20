import { nowIso } from "../../utils/time";
import { queryPage, type OffsetPageQuery } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import type { EmailMessageType } from "../../../../assets/shared/schemas/api-common";
import type { EmailOutboxQuery, EmailOutboxStatus } from "../../../../assets/shared/schemas/email-outbox";

const EMAIL_OUTBOX_COLUMNS = `SELECT o.id, o.event_id, e.slug AS event_slug, e.name AS event_name,
  o.template_key, o.template_version, o.recipient_email, o.subject, o.payload_json,
  o.message_type, o.provider, o.provider_message_id, o.status, o.attempts, o.send_after,
  o.last_error, o.created_at, o.updated_at, o.sent_at`;
export const EMAIL_OUTBOX_SELECT = `${EMAIL_OUTBOX_COLUMNS}
  FROM email_outbox o LEFT JOIN events e ON e.id = o.event_id`;

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

export interface EmailOutboxQueryStatements {
  page: OffsetPageQuery;
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
 * Builds the exact filtered page/count source used by the API.
 * Keeping this pure lets D1 EXPLAIN tests inspect production SQL rather than a
 * simplified copy that can drift from the endpoint.
 */
export function buildEmailOutboxQueryStatements(query: EmailOutboxQuery, now: string): EmailOutboxQueryStatements {
  const { where, bindings } = buildWhereClause({ ...query, now });
  // The due-only partial index must win over the general status index for
  // delivery work, even before SQLite has representative planner statistics.
  const source = `FROM email_outbox o${query.dueNow ? " INDEXED BY idx_email_outbox_due" : ""}`;
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      recipient: "o.recipient_email COLLATE NOCASE",
      template: "o.template_key COLLATE NOCASE",
      status: "o.status COLLATE NOCASE",
      sendAfter: "o.send_after",
      createdAt: "o.created_at",
    },
    "o.created_at DESC",
    "o.id ASC",
  );
  return {
    page: {
      source: {
        selectSql: EMAIL_OUTBOX_COLUMNS,
        fromSql: `${source} LEFT JOIN events e ON e.id = o.event_id ${where}`,
        countFromSql: `${source}${query.q ? " LEFT JOIN events e ON e.id = o.event_id" : ""} ${where}`,
        bindings,
      },
      orderBy,
      limit: query.limit,
      offset: query.offset,
    },
  };
}

export async function queryEmailOutbox(db: DatabaseLike, query: EmailOutboxQuery) {
  return queryPage<OutboxListRow>(db, buildEmailOutboxQueryStatements(query, nowIso()).page);
}
