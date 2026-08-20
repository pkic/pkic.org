import { all, first } from "../../db/queries";
import { parseQueuedEmailAttachments } from "../../email/attachments";
import { renderSubject } from "../../email/render";
import { resolveTemplate } from "../../email/templates";
import { parseJsonSafe } from "../../utils/json";
import type { DatabaseLike } from "../../types";
import type { AdminEmailOutboxRow } from "../../../../assets/shared/schemas/admin-email-outbox";
import type { OutboxListRow } from "./query";

interface TemplateSubjectRow {
  subject_template: string | null;
}

interface TemplateVersionSubjectRow {
  template_key: string;
  version: number;
  subject_template: string | null;
}

interface ActiveTemplateSubjectRow {
  template_key: string;
  subject_template: string | null;
}

async function preloadVersionedSubjectTemplates(
  db: DatabaseLike,
  rows: OutboxListRow[],
  cache: Map<string, string | null>,
): Promise<void> {
  const pairs = [
    ...new Map(
      rows
        .filter((row): row is OutboxListRow & { template_version: number } => row.template_version !== null)
        .map((row) => [`${row.template_key}:${row.template_version}`, row] as const),
    ).values(),
  ];

  for (let offset = 0; offset < pairs.length; offset += 25) {
    const chunk = pairs.slice(offset, offset + 25);
    const versionRows = await all<TemplateVersionSubjectRow>(
      db,
      `SELECT template_key, version, subject_template
       FROM email_template_versions
       WHERE ${chunk.map(() => "(template_key = ? AND version = ?)").join(" OR ")}`,
      chunk.flatMap((row) => [row.template_key, row.template_version]),
    );
    for (const row of versionRows) {
      cache.set(`${row.template_key}:${row.version}`, row.subject_template ?? null);
    }
    for (const row of chunk) {
      const key = `${row.template_key}:${row.template_version}`;
      if (!cache.has(key)) cache.set(key, null);
    }
  }
}

async function preloadActiveSubjectTemplates(
  db: DatabaseLike,
  rows: OutboxListRow[],
  cache: Map<string, string | null>,
): Promise<void> {
  const keys = [...new Set(rows.filter((row) => row.template_version === null).map((row) => row.template_key))];

  for (let offset = 0; offset < keys.length; offset += 50) {
    const chunk = keys.slice(offset, offset + 50);
    const activeRows = await all<ActiveTemplateSubjectRow>(
      db,
      `SELECT template_key, subject_template
       FROM email_template_versions
       WHERE status = 'active' AND template_key IN (${chunk.map(() => "?").join(", ")})
       ORDER BY template_key ASC, version DESC`,
      chunk,
    );
    for (const row of activeRows) {
      const cacheKey = `${row.template_key}:active`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, row.subject_template ?? null);
    }
    for (const key of chunk) {
      const cacheKey = `${key}:active`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, null);
    }
  }
}

async function resolveSubjectTemplate(
  db: DatabaseLike,
  row: OutboxListRow,
  cache: Map<string, string | null>,
): Promise<string | null> {
  if (row.template_version !== null) {
    const cacheKey = `${row.template_key}:${row.template_version}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
    const version = await first<TemplateSubjectRow>(
      db,
      "SELECT subject_template FROM email_template_versions WHERE template_key = ? AND version = ?",
      [row.template_key, row.template_version],
    );
    const subject = version?.subject_template ?? null;
    cache.set(cacheKey, subject);
    return subject;
  }

  const cacheKey = `${row.template_key}:active`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;
  try {
    const active = await resolveTemplate(db, row.template_key);
    cache.set(cacheKey, active.subjectTemplate ?? null);
    return active.subjectTemplate ?? null;
  } catch {
    cache.set(cacheKey, null);
    return null;
  }
}

async function buildPreviewSubject(
  db: DatabaseLike,
  row: OutboxListRow,
  payload: Record<string, unknown>,
  cache: Map<string, string | null>,
): Promise<string> {
  const directBody =
    typeof payload.__adminCampaignBodyContent === "string" && payload.__adminCampaignBodyContent.length > 0;
  const fallback = row.subject ?? "PKI Consortium Update";
  if (directBody) return renderSubject(row.subject, fallback, payload);
  return renderSubject(await resolveSubjectTemplate(db, row, cache), fallback, payload);
}

export async function buildAdminEmailOutboxRows(
  db: DatabaseLike,
  rows: OutboxListRow[],
): Promise<AdminEmailOutboxRow[]> {
  const cache = new Map<string, string | null>();
  await preloadVersionedSubjectTemplates(db, rows, cache);
  await preloadActiveSubjectTemplates(db, rows, cache);

  return Promise.all(
    rows.map(async (row) => {
      const payload = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const firstName = typeof payload.firstName === "string" ? payload.firstName.trim() : "";
      const lastName = typeof payload.lastName === "string" ? payload.lastName.trim() : "";
      const bccRecipients = Array.isArray(payload.__bccRecipients)
        ? payload.__bccRecipients.filter((item): item is string => typeof item === "string" && item.includes("@"))
        : [];

      return {
        id: row.id,
        eventSlug: row.event_slug,
        eventName: row.event_name ?? (typeof payload.eventName === "string" ? payload.eventName : null),
        templateKey: row.template_key,
        templateVersion: row.template_version,
        recipientEmail: row.recipient_email,
        recipientName: [firstName, lastName].filter(Boolean).join(" ") || null,
        subject: await buildPreviewSubject(db, row, payload, cache),
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
        hasBadgeAttachment: parseQueuedEmailAttachments(payload).length > 0,
        usesDirectBody:
          typeof payload.__adminCampaignBodyContent === "string" && payload.__adminCampaignBodyContent.length > 0,
        hasCustomText:
          typeof payload.__adminCampaignCustomText === "string" && payload.__adminCampaignCustomText.trim().length > 0,
      };
    }),
  );
}
