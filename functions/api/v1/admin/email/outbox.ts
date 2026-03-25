/**
 * GET /api/v1/admin/email/outbox
 *
 * Returns a paginated outbox view for the admin console with enough context
 * to understand what is queued, what was sent, and why rows failed.
 *
 * Query params:
 *   status       - optional status filter
 *   messageType  - optional message type filter: transactional | promotional
 *   dueNow       - optional boolean filter for rows actionable now (queued/retrying and send_after <= now)
 *   q            - optional search across recipient, template, event, subject, error
 *   limit        - max rows (default 50, max 200)
 *   offset       - pagination offset (default 0)
 */

import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { all, first } from "../../../../_lib/db/queries";
import { renderSubject } from "../../../../_lib/email/render";
import { resolveTemplate } from "../../../../_lib/email/templates";
import { json } from "../../../../_lib/http";
import { parseJsonSafe } from "../../../../_lib/utils/json";
import type { PagesContext } from "../../../../_lib/types";

interface OutboxListRow {
  id: string;
  event_id: string | null;
  event_slug: string | null;
  event_name: string | null;
  template_key: string;
  template_version: number | null;
  recipient_email: string;
  subject: string | null;
  payload_json: string;
  message_type: "transactional" | "promotional";
  provider: string;
  provider_message_id: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "retrying";
  attempts: number;
  send_after: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

interface TemplateSubjectRow {
  subject_template: string | null;
}

interface CountRow {
  status: string;
  count: number;
}

interface MessageTypeCountRow {
  message_type: string;
  count: number;
}

interface TemplateCountRow {
  template_key: string;
  count: number;
}

interface DueCountRow {
  status: string;
  count: number;
}

function buildWhereClause(
  status: string,
  messageType: string,
  search: string,
  dueNow: boolean,
): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (dueNow) {
    conditions.push("o.status IN ('queued', 'retrying')");
    conditions.push("o.send_after <= ?");
    params.push(new Date().toISOString());
  }

  if (status) {
    conditions.push("o.status = ?");
    params.push(status);
  }

  if (messageType) {
    conditions.push("o.message_type = ?");
    params.push(messageType);
  }

  if (search) {
    conditions.push(
      `(
        o.recipient_email LIKE ?
        OR o.template_key LIKE ?
        OR COALESCE(o.subject, '') LIKE ?
        OR COALESCE(o.last_error, '') LIKE ?
        OR COALESCE(e.slug, '') LIKE ?
        OR COALESCE(e.name, '') LIKE ?
      )`,
    );
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

async function resolveSubjectTemplate(
  context: PagesContext,
  row: OutboxListRow,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (row.template_version !== null) {
    const cacheKey = `${row.template_key}:${row.template_version}`;
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }

    const versionRow = await first<TemplateSubjectRow>(
      context.env.DB,
      "SELECT subject_template FROM email_template_versions WHERE template_key = ? AND version = ?",
      [row.template_key, row.template_version],
    );
    const subjectTemplate = versionRow?.subject_template ?? null;
    cache.set(cacheKey, subjectTemplate);
    return subjectTemplate;
  }

  const cacheKey = `${row.template_key}:active`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  try {
    const active = await resolveTemplate(context.env.DB, row.template_key);
    cache.set(cacheKey, active.subjectTemplate ?? null);
    return active.subjectTemplate ?? null;
  } catch {
    cache.set(cacheKey, null);
    return null;
  }
}

async function buildPreviewSubject(
  context: PagesContext,
  row: OutboxListRow,
  payload: Record<string, unknown>,
  cache: Map<string, string | null>,
): Promise<string> {
  const directBody = typeof payload.__adminCampaignBodyContent === "string" && payload.__adminCampaignBodyContent.length > 0;
  const fallbackSubject = row.subject ?? "PKI Consortium Update";

  if (directBody) {
    return renderSubject(row.subject, fallbackSubject, payload);
  }

  const subjectTemplate = await resolveSubjectTemplate(context, row, cache);
  return renderSubject(subjectTemplate, fallbackSubject, payload);
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const url = new URL(context.request.url);
  const status = (url.searchParams.get("status") ?? "").trim().toLowerCase();
  const messageType = (url.searchParams.get("messageType") ?? "").trim().toLowerCase();
  const dueNow = ["1", "true", "yes"].includes((url.searchParams.get("dueNow") ?? "").trim().toLowerCase());
  const search = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  const { where, params } = buildWhereClause(status, messageType, search, dueNow);

  const [rows, totalRow, statusCounts, messageTypeCounts, templateCounts, dueCounts, dueNextRow] = await Promise.all([
    all<OutboxListRow>(
      context.env.DB,
      `SELECT
         o.id,
         o.event_id,
         e.slug AS event_slug,
         e.name AS event_name,
         o.template_key,
         o.template_version,
         o.recipient_email,
         o.subject,
         o.payload_json,
         o.message_type,
         o.provider,
         o.provider_message_id,
         o.status,
         o.attempts,
         o.send_after,
         o.last_error,
         o.created_at,
         o.updated_at,
         o.sent_at
       FROM email_outbox o
       LEFT JOIN events e ON e.id = o.event_id
       ${where}
       ORDER BY
         CASE o.status
           WHEN 'failed' THEN 0
           WHEN 'retrying' THEN 1
           WHEN 'queued' THEN 2
           WHEN 'sending' THEN 3
           ELSE 4
         END,
         COALESCE(o.sent_at, o.updated_at, o.created_at) DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    first<{ total: number }>(
      context.env.DB,
      `SELECT COUNT(*) AS total
       FROM email_outbox o
       LEFT JOIN events e ON e.id = o.event_id
       ${where}`,
      params,
    ),
    all<CountRow>(
      context.env.DB,
      `SELECT o.status, COUNT(*) AS count
       FROM email_outbox o
       LEFT JOIN events e ON e.id = o.event_id
       ${where}
       GROUP BY o.status`,
      params,
    ),
    all<MessageTypeCountRow>(
      context.env.DB,
      `SELECT o.message_type, COUNT(*) AS count
       FROM email_outbox o
       LEFT JOIN events e ON e.id = o.event_id
       ${where}
       GROUP BY o.message_type`,
      params,
    ),
    all<TemplateCountRow>(
      context.env.DB,
      `SELECT o.template_key, COUNT(*) AS count
       FROM email_outbox o
       LEFT JOIN events e ON e.id = o.event_id
       ${where}
       GROUP BY o.template_key
       ORDER BY count DESC, o.template_key ASC
       LIMIT 5`,
      params,
    ),
    all<DueCountRow>(
      context.env.DB,
      `SELECT status, COUNT(*) AS count
       FROM email_outbox
       WHERE status IN ('queued', 'retrying')
         AND send_after <= ?
       GROUP BY status`,
      [new Date().toISOString()],
    ),
    first<{ send_after: string | null }>(
      context.env.DB,
      `SELECT MIN(send_after) AS send_after
       FROM email_outbox
       WHERE status IN ('queued', 'retrying')`,
      [],
    ),
  ]);

  const subjectTemplateCache = new Map<string, string | null>();
  const outbox = await Promise.all(rows.map(async (row) => {
    const payload = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
    const firstName = typeof payload.firstName === "string" ? payload.firstName.trim() : "";
    const lastName = typeof payload.lastName === "string" ? payload.lastName.trim() : "";
    const recipientName = [firstName, lastName].filter(Boolean).join(" ") || null;
    const bccRecipients = Array.isArray(payload.__bccRecipients)
      ? payload.__bccRecipients.filter((item): item is string => typeof item === "string" && item.includes("@"))
      : [];
    const previewSubject = await buildPreviewSubject(context, row, payload, subjectTemplateCache);
    const directBody = typeof payload.__adminCampaignBodyContent === "string" && payload.__adminCampaignBodyContent.length > 0;
    const customText = typeof payload.__adminCampaignCustomText === "string" && payload.__adminCampaignCustomText.trim().length > 0;
    const payloadEventName = typeof payload.eventName === "string" ? payload.eventName : null;

    return {
      id: row.id,
      eventSlug: row.event_slug,
      eventName: row.event_name ?? payloadEventName,
      templateKey: row.template_key,
      templateVersion: row.template_version,
      recipientEmail: row.recipient_email,
      recipientName,
      subject: previewSubject,
      messageType: row.message_type,
      provider: row.provider,
      providerMessageId: row.provider_message_id,
      status: row.status,
      attempts: row.attempts,
      sendAfter: row.send_after,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sentAt: row.sent_at,
      bccRecipientCount: bccRecipients.length,
      hasCalendarInvite: Boolean(payload.__calendarInvite),
      hasBadgeAttachment: typeof payload.__badgeCode === "string" && payload.__badgeCode.length > 0,
      usesDirectBody: directBody,
      hasCustomText: customText,
    };
  }));

  return json({
    outbox,
    summary: {
      total: Number(totalRow?.total ?? 0),
      byStatus: Object.fromEntries(statusCounts.map((row) => [row.status, row.count])),
      byMessageType: Object.fromEntries(messageTypeCounts.map((row) => [row.message_type, row.count])),
      topTemplates: templateCounts,
      dueNow: dueCounts.reduce((sum, row) => sum + Number(row.count ?? 0), 0),
      dueByStatus: Object.fromEntries(dueCounts.map((row) => [row.status, Number(row.count ?? 0)])),
      nextSendAfter: dueNextRow?.send_after ?? null,
    },
    page: {
      limit,
      offset,
      total: Number(totalRow?.total ?? 0),
      hasMore: offset + outbox.length < Number(totalRow?.total ?? 0),
    },
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}