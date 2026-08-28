import { all, first, run } from "../db/queries";
import { buildD1JsonMembershipFilter } from "../db/json-membership";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import { logError } from "../logging";
import { resolveAppBaseUrl } from "../config";
import { resolveTemplate } from "./templates";
import { renderEmail, renderSubject } from "./render";
import { loadEmailRenderResources } from "./partials";
import { sendViaSendgrid } from "./sendgrid";
import { applyCampaignCustomText } from "./campaign-custom";
import { parseQueuedEmailAttachments } from "./attachments";
import { materializeQueuedCapabilityLinks } from "../auth/capability-links";
import type { DatabaseLike, Env } from "../types";
import type { EmailContentType, EmailMessageType } from "../../../assets/shared/schemas/email-templates";
import type { CalendarPayload } from "./outbox-queue";
import { createDurableJobLease } from "../jobs/lease";
import { resolveImageAttachmentFormat } from "../utils/image-format";
import type { AdminEmailOutboxStatus } from "../../../assets/shared/schemas/admin-email-outbox";

export * from "./outbox-queue";

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 12288; // 12kb chunks to avoid stack overflow
  let result = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    result += String.fromCharCode(...chunk);
  }
  return btoa(result);
}

interface OutboxRow {
  id: string;
  event_id: string | null;
  template_key: string;
  template_version: number | null;
  recipient_user_id: string | null;
  recipient_email: string;
  subject: string | null;
  payload_json: string;
  message_type: EmailMessageType;
  provider: string;
  provider_message_id: string | null;
  status: AdminEmailOutboxStatus;
  attempts: number;
  send_after: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  processing_token: string | null;
  lease_expires_at: string | null;
}

const OUTBOX_ROW_COLUMNS = `id, event_id, template_key, template_version, recipient_user_id, recipient_email,
  subject, payload_json, message_type, provider, provider_message_id, status, attempts, send_after,
  last_error, created_at, updated_at, sent_at, processing_token, lease_expires_at`;

export const EMAIL_OUTBOX_DUE_QUERY = `
  SELECT ${OUTBOX_ROW_COLUMNS}
    FROM email_outbox
   WHERE status IN ('queued', 'retrying') AND send_after <= ?
  ORDER BY send_after, created_at, id
  LIMIT ?`;

export const EMAIL_OUTBOX_EXPIRED_LEASE_QUERY = `
  UPDATE email_outbox
     SET status = 'delivery_unknown', attempts = attempts + 1,
         last_error = 'SENDGRID_DELIVERY_UNKNOWN: Send interrupted before its delivery outcome was persisted',
         processing_token = NULL, lease_expires_at = NULL, updated_at = ?
   WHERE id IN (
     SELECT id
       FROM email_outbox
      WHERE status = 'sending' AND lease_expires_at <= ?
      ORDER BY lease_expires_at, created_at, id
      LIMIT ?
   )
     AND status = 'sending' AND lease_expires_at <= ?`;

type ResolvedEmailTemplate = Awaited<ReturnType<typeof resolveTemplate>>;

interface OutboxProcessingContext {
  renderResources?: Promise<{ partials: Record<string, string>; layoutHtml: string }>;
  templates: Map<string, Promise<ResolvedEmailTemplate>>;
}

function createOutboxProcessingContext(): OutboxProcessingContext {
  return { templates: new Map() };
}

function loadRenderResources(
  db: DatabaseLike,
  context: OutboxProcessingContext,
): Promise<{ partials: Record<string, string>; layoutHtml: string }> {
  context.renderResources ??= loadEmailRenderResources(db);
  return context.renderResources;
}

function resolveTemplateOnce(
  db: DatabaseLike,
  context: OutboxProcessingContext,
  templateKey: string,
): Promise<ResolvedEmailTemplate> {
  const existing = context.templates.get(templateKey);
  if (existing) return existing;
  const pending = resolveTemplate(db, templateKey);
  context.templates.set(templateKey, pending);
  return pending;
}

function getOutboxStatusForRetry(attempts: number): "retrying" | "failed" {
  return attempts >= 5 ? "failed" : "retrying";
}

function outboxRetryAt(attempts: number): string {
  const delayMs = Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMs).toISOString();
}

function outboxErrorMessage(error: unknown): string {
  const message =
    error instanceof AppError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : "Unknown email send error";
  const details = error instanceof AppError && error.details ? ` | details: ${stringifyJson(error.details)}` : "";
  return message + details;
}

function resolveEmailBaseUrl(payload: Record<string, unknown>, env: Env): string {
  if (typeof payload.__baseUrl === "string" && payload.__baseUrl) {
    const explicitBaseUrl = payload.__baseUrl;
    return explicitBaseUrl;
  }

  return resolveAppBaseUrl(env);
}

async function claimOutboxForSending(db: DatabaseLike, outboxId: string): Promise<string | null> {
  const lease = createDurableJobLease();
  const claimed = await run(
    db,
    `UPDATE email_outbox
     SET status = 'sending', processing_token = ?, lease_expires_at = ?, updated_at = ?
     WHERE id = ?
       AND send_after <= ?
       AND status IN ('queued', 'retrying')`,
    [lease.token, lease.expiresAt, lease.claimedAt, outboxId, lease.claimedAt],
  );
  return claimed.changes === 1 ? lease.token : null;
}

async function markOutboxSent(
  db: DatabaseLike,
  row: OutboxRow,
  processingToken: string,
  messageId: string | null,
  templateVersion: number,
): Promise<void> {
  await run(
    db,
    `UPDATE email_outbox
     SET status = 'sent', template_version = ?, provider_message_id = ?, sent_at = ?,
         last_error = NULL, processing_token = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'sending' AND processing_token = ?`,
    [templateVersion, messageId, nowIso(), nowIso(), row.id, processingToken],
  );

  // Calendar delivery is tracked through email_outbox rows to keep storage/model simple.
}

async function markOutboxFailed(
  db: DatabaseLike,
  row: OutboxRow,
  processingToken: string,
  error: unknown,
): Promise<void> {
  const attempts = row.attempts + 1;
  const nonRetryable =
    error instanceof AppError &&
    (error.code === "CAPABILITY_RESOURCE_STALE" ||
      error.code === "CAPABILITY_DESCRIPTOR_INVALID" ||
      error.code === "EMAIL_TEMPLATE_RENDER_LIMIT_EXCEEDED");
  const status =
    error instanceof AppError && error.code === "CAPABILITY_RESOURCE_STALE"
      ? "cancelled"
      : nonRetryable
        ? "failed"
        : getOutboxStatusForRetry(attempts);
  await run(
    db,
    `UPDATE email_outbox
     SET attempts = ?, status = ?, last_error = ?, send_after = ?, processing_token = NULL,
         lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'sending' AND processing_token = ?`,
    [
      attempts,
      status,
      outboxErrorMessage(error),
      status === "retrying" ? outboxRetryAt(attempts) : row.send_after,
      nowIso(),
      row.id,
      processingToken,
    ],
  );
}

async function markOutboxDeliveryUnknown(
  db: DatabaseLike,
  row: OutboxRow,
  processingToken: string,
  error: unknown,
  messageId: string | null | undefined,
  templateVersion: number,
): Promise<void> {
  await run(
    db,
    `UPDATE email_outbox
     SET attempts = ?, status = 'delivery_unknown', template_version = ?,
         provider_message_id = COALESCE(?, provider_message_id), last_error = ?,
         processing_token = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'sending' AND processing_token = ?`,
    [
      row.attempts + 1,
      templateVersion,
      messageId ?? null,
      outboxErrorMessage(error),
      nowIso(),
      row.id,
      processingToken,
    ],
  );
}

async function quarantineExpiredOutboxLeases(db: DatabaseLike, limit: number): Promise<void> {
  const now = nowIso();
  await run(db, EMAIL_OUTBOX_EXPIRED_LEASE_QUERY, [now, now, limit, now]);
}

async function processOutboxRow(
  db: DatabaseLike,
  env: Env,
  row: OutboxRow,
  context: OutboxProcessingContext,
): Promise<boolean> {
  // Honour send_after — sleep until the scheduled time before sending.
  const sendAfterMs = new Date(row.send_after).getTime() - Date.now();
  if (sendAfterMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, sendAfterMs));
  }

  // Selection and delivery are intentionally separate operations. Multiple
  // scheduled/admin/direct processors may therefore select the same queued
  // row. Claim it with a guarded write before contacting SendGrid so only one
  // invocation owns the external side effect.
  const processingToken = await claimOutboxForSending(db, row.id);
  if (!processingToken) return false;

  let acceptedMessageId: string | null | undefined;
  let resolvedTemplateVersion = 0;

  try {
    const storedPayload = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
    const payload = await materializeQueuedCapabilityLinks(db, env, storedPayload);
    const { partials, layoutHtml } = await loadRenderResources(db, context);
    const emailBaseUrl = resolveEmailBaseUrl(payload, env);
    const dataWithPartials = { ...payload, _partials: partials };
    const bodyOverride =
      typeof payload.__adminCampaignBodyContent === "string" && payload.__adminCampaignBodyContent
        ? payload.__adminCampaignBodyContent
        : null;

    let subject: string;
    let contentWithCustom: string;
    let resolvedContentType: EmailContentType;

    if (bodyOverride) {
      // Direct body still supports subject placeholders like {{eventName}}.
      subject = renderSubject(row.subject, row.subject ?? "PKI Consortium Update", dataWithPartials);
      contentWithCustom = bodyOverride;
      resolvedContentType = "markdown";
    } else {
      const template = await resolveTemplateOnce(db, context, row.template_key);
      resolvedTemplateVersion = template.version;
      resolvedContentType = template.contentType as EmailContentType;
      const customText =
        typeof payload.__adminCampaignCustomText === "string" ? payload.__adminCampaignCustomText : null;
      contentWithCustom = applyCampaignCustomText(template.content, resolvedContentType, customText);
      subject = renderSubject(template.subjectTemplate, row.subject ?? "PKI Consortium Update", dataWithPartials);
    }
    const rendered = await renderEmail(
      contentWithCustom,
      dataWithPartials,
      layoutHtml,
      resolvedContentType,
      emailBaseUrl,
    );

    let attachments: Array<{ filename: string; contentType: string; base64Content: string }> | undefined;
    const calendar = payload.__calendarInvite as CalendarPayload | undefined;
    if (calendar?.icsFiles?.length) {
      attachments = calendar.icsFiles.map((f) => ({
        filename: f.filename,
        contentType: "application/ics",
        base64Content: uint8ToBase64(new TextEncoder().encode(f.content)),
      }));
    }

    // Attach badge to email. prerenderAndCache stores a JPEG at og-badges/{code}
    // (same 1200×630 as the OG image, JPEG q85 — ~80–90 % smaller than PNG).
    // In local dev (no IMAGES binding) it may fall back to PNG — we read the
    // content-type from the R2 object's httpMetadata to use the correct extension.
    const queuedAttachments = parseQueuedEmailAttachments(payload);
    const badgeAttachments = queuedAttachments.filter((a) => a.kind === "r2-badge-image");
    if (badgeAttachments.length > 0 && env.ASSETS_BUCKET) {
      try {
        for (const badgeAttachment of badgeAttachments) {
          const badgeObj = await env.ASSETS_BUCKET.get(badgeAttachment.r2Key);
          if (!badgeObj) {
            continue;
          }

          const declaredType = badgeObj.httpMetadata?.contentType ?? "image/jpeg";
          const buf = await badgeObj.arrayBuffer();
          const bytes = new Uint8Array(buf);
          const format = resolveImageAttachmentFormat(declaredType, bytes);
          const base64 = uint8ToBase64(bytes);
          const badgeFilename = `${badgeAttachment.filenameBase}.${format.extension}`;
          attachments = [
            ...(attachments ?? []),
            { filename: badgeFilename, contentType: format.contentType, base64Content: base64 },
          ];
        }
      } catch {
        // Badge not yet rendered — send email without attachment (non-fatal)
      }
    }

    const bccRecipients = Array.isArray(payload.__bccRecipients)
      ? payload.__bccRecipients.filter((item): item is string => typeof item === "string" && item.includes("@"))
      : undefined;

    acceptedMessageId = await sendViaSendgrid(env, {
      outboxId: row.id,
      to: row.recipient_email,
      bcc: bccRecipients,
      subject,
      html: rendered.html,
      text: rendered.text,
      // Always send inline content — email clients (Gmail, Apple Mail, Outlook)
      // use the text/calendar alternative with method=REQUEST for the native
      // accept/decline prompt. Generated per-day .ics attachments provide granular control.
      calendarIcsContent: calendar?.inlineContent,
      categories: [row.template_key, row.message_type],
      replyTo: typeof payload.__replyTo === "string" ? payload.__replyTo : undefined,
      attachments,
    });

    await markOutboxSent(db, row, processingToken, acceptedMessageId, resolvedTemplateVersion);
    return true;
  } catch (error) {
    const deliveryUnknown =
      acceptedMessageId !== undefined || (error instanceof AppError && error.code === "SENDGRID_DELIVERY_UNKNOWN");
    if (deliveryUnknown) {
      await markOutboxDeliveryUnknown(db, row, processingToken, error, acceptedMessageId, resolvedTemplateVersion);
    } else {
      await markOutboxFailed(db, row, processingToken, error);
    }
    throw error;
  }
}

export async function processOutboxById(db: DatabaseLike, env: Env, outboxId: string): Promise<void> {
  const row = await first<OutboxRow>(db, `SELECT ${OUTBOX_ROW_COLUMNS} FROM email_outbox WHERE id = ?`, [outboxId]);
  if (!row) {
    throw new AppError(404, "OUTBOX_NOT_FOUND", "Outbox message not found");
  }
  await processOutboxRow(db, env, row, createOutboxProcessingContext());
}

export async function processOutboxByIdBackground(db: DatabaseLike, env: Env, outboxId: string): Promise<void> {
  try {
    await processOutboxById(db, env, outboxId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown background email error";
    const details = error instanceof AppError ? error.details : undefined;
    logError("EMAIL_OUTBOX_PROCESS_FAILED", { outboxId, error: message, ...(details ? { details } : {}) });
  }
}

/** Process rows in bounded parallel chunks while sharing immutable render resources. */
async function processInChunks(
  db: DatabaseLike,
  env: Env,
  rows: OutboxRow[],
  chunkSize = 10,
): Promise<{ processed: number; failed: number }> {
  if (rows.length === 0) return { processed: 0, failed: 0 };
  const context = createOutboxProcessingContext();
  let failed = 0;
  let processed = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const results = await Promise.allSettled(chunk.map((row) => processOutboxRow(db, env, row, context)));
    failed += results.filter((r) => r.status === "rejected").length;
    processed += results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && r.value)).length;
  }
  return { processed, failed };
}

export async function processPendingOutbox(
  db: DatabaseLike,
  env: Env,
  limit = 20,
): Promise<{ processed: number; failed: number }> {
  await quarantineExpiredOutboxLeases(db, limit);
  const rows = await all<OutboxRow>(db, EMAIL_OUTBOX_DUE_QUERY, [nowIso(), limit]);

  return processInChunks(db, env, rows);
}

export async function summarizePendingOutbox(
  db: DatabaseLike,
): Promise<{ dueNow: number; dueByStatus: Record<string, number>; nextSendAfter: string | null }> {
  const now = nowIso();
  const rows = await all<{ status: string; count: number }>(
    db,
    `SELECT status, COUNT(*) AS count
     FROM email_outbox
     WHERE send_after <= ?
       AND status IN ('queued', 'retrying')
     GROUP BY status`,
    [now],
  );

  const nextRow = await first<{ send_after: string | null }>(
    db,
    `SELECT MIN(send_after) AS send_after
     FROM email_outbox
     WHERE status IN ('queued', 'retrying')`,
  );

  return {
    dueNow: rows.reduce((sum, row) => sum + Number(row.count ?? 0), 0),
    dueByStatus: Object.fromEntries(rows.map((row) => [row.status, Number(row.count ?? 0)])),
    nextSendAfter: nextRow?.send_after ?? null,
  };
}

export async function processSelectedOutbox(
  db: DatabaseLike,
  env: Env,
  ids: string[],
): Promise<{ processed: number; failed: number; skipped: number }> {
  if (!ids.length) {
    return { processed: 0, failed: 0, skipped: 0 };
  }

  const idFilter = buildD1JsonMembershipFilter("id", ids);
  const rows = await all<OutboxRow>(
    db,
    `SELECT ${OUTBOX_ROW_COLUMNS} FROM email_outbox
     WHERE ${idFilter.sql}
       AND send_after <= ?
       AND status IN ('queued', 'retrying')
     ORDER BY created_at ASC`,
    [...idFilter.bindings, nowIso()],
  );

  const results = await processInChunks(db, env, rows);
  return {
    ...results,
    skipped: Math.max(0, ids.length - results.processed),
  };
}

export async function processSelectedOutboxBackground(db: DatabaseLike, env: Env, ids: string[]): Promise<void> {
  try {
    await processSelectedOutbox(db, env, ids);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown background outbox selection error";
    logError("EMAIL_OUTBOX_SELECTION_FAILED", { count: ids.length, error: message });
  }
}

export async function processPendingOutboxBackground(db: DatabaseLike, env: Env, limit = 20): Promise<void> {
  try {
    await processPendingOutbox(db, env, limit);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown background outbox batch error";
    logError("EMAIL_OUTBOX_BATCH_FAILED", { limit, error: message });
  }
}

/**
 * Resets failed or delivery-unknown outbox records back to 'retrying' after
 * an operator has decided that replaying the external side effect is safe.
 *
 * @param db    - D1 database binding
 * @param ids   - Optional list of outbox IDs to reset. If omitted, resets all failed/unknown rows.
 * @returns     - Number of rows reset.
 */
export async function resetFailedOutbox(db: DatabaseLike, ids?: string[]): Promise<{ reset: number }> {
  const now = nowIso();
  if (ids && ids.length > 0) {
    const idFilter = buildD1JsonMembershipFilter("id", ids);
    const result = await run(
      db,
      `UPDATE email_outbox
       SET status = 'retrying', attempts = 0, send_after = ?, updated_at = ?
       WHERE status IN ('failed', 'delivery_unknown') AND ${idFilter.sql}`,
      [now, now, ...idFilter.bindings],
    );
    return { reset: result.changes };
  }

  const result = await run(
    db,
    `UPDATE email_outbox
     SET status = 'retrying', attempts = 0, send_after = ?, updated_at = ?
     WHERE status IN ('failed', 'delivery_unknown')`,
    [now, now],
  );
  return { reset: result.changes };
}
