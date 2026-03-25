import { all, first, run } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import { uuid } from "../utils/ids";
import { logError } from "../logging";
import { resolveAppBaseUrl } from "../config";
import { resolveTemplate } from "./templates";
import { renderEmail, renderSubject } from "./render";
import { loadEmailLayout, loadEmailPartials } from "./partials";
import { sendViaSendgrid } from "./sendgrid";
import { applyCampaignCustomText } from "./campaign-custom";
import type { DatabaseLike, Env } from "../types";

interface OutboxRow {
  id: string;
  event_id: string | null;
  template_key: string;
  template_version: number | null;
  recipient_user_id: string | null;
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

interface CalendarPayload {
  registrationId: string;
  eventId: string;
  icsUid: string;
  icsContent: string;
}

function getOutboxStatusForRetry(attempts: number): "retrying" | "failed" {
  return attempts >= 5 ? "failed" : "retrying";
}

export async function queueEmail(
  db: DatabaseLike,
  payload: {
    eventId?: string | null;
    templateKey: string;
    recipientUserId?: string | null;
    recipientEmail: string;
    subject?: string | null;
    data: Record<string, unknown>;
    messageType: "transactional" | "promotional";
    calendar?: CalendarPayload;
    /** Delay delivery by this many seconds (e.g. to let OG badge rendering finish). */
    sendAfterSeconds?: number;
  },
): Promise<string> {
  const id = uuid();
  const data = { ...payload.data } as Record<string, unknown>;

  if (payload.calendar) {
    data.__calendarInvite = payload.calendar;
  }

  const sendAfter = payload.sendAfterSeconds && payload.sendAfterSeconds > 0
    ? new Date(Date.now() + payload.sendAfterSeconds * 1000).toISOString()
    : nowIso();

  await run(
    db,
    `INSERT INTO email_outbox (
      id, event_id, template_key, template_version, recipient_user_id, recipient_email,
      subject, payload_json, message_type, provider, provider_message_id, status, attempts,
      send_after, last_error, created_at, updated_at, sent_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'sendgrid', NULL, 'queued', 0, ?, NULL, ?, ?, NULL)`,
    [
      id,
      payload.eventId ?? null,
      payload.templateKey,
      payload.recipientUserId ?? null,
      payload.recipientEmail,
      payload.subject ?? null,
      stringifyJson(data),
      payload.messageType,
      sendAfter,
      nowIso(),
      nowIso(),
    ],
  );

  return id;
}

async function markOutboxSending(db: DatabaseLike, outboxId: string): Promise<void> {
  await run(db, "UPDATE email_outbox SET status = 'sending', updated_at = ? WHERE id = ?", [nowIso(), outboxId]);
}

async function markOutboxSent(
  db: DatabaseLike,
  row: OutboxRow,
  messageId: string | null,
  templateVersion: number,
): Promise<void> {
  await run(
    db,
    `UPDATE email_outbox
     SET status = 'sent', template_version = ?, provider_message_id = ?, sent_at = ?, last_error = NULL, updated_at = ?
     WHERE id = ?`,
    [templateVersion, messageId, nowIso(), nowIso(), row.id],
  );

  // Calendar delivery is tracked through email_outbox rows to keep storage/model simple.
}

async function markOutboxFailed(db: DatabaseLike, row: OutboxRow, error: unknown): Promise<void> {
  const attempts = row.attempts + 1;
  const status = getOutboxStatusForRetry(attempts);
  const message = error instanceof Error ? error.message : "Unknown email send error";
  const details = error instanceof AppError && error.details ? ` | details: ${stringifyJson(error.details)}` : "";

  await run(
    db,
    `UPDATE email_outbox
     SET attempts = ?, status = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
    [attempts, status, message + details, nowIso(), row.id],
  );
}

export async function processOutboxById(db: DatabaseLike, env: Env, outboxId: string): Promise<void> {
  const row = await first<OutboxRow>(db, "SELECT * FROM email_outbox WHERE id = ?", [outboxId]);
  if (!row) {
    throw new AppError(404, "OUTBOX_NOT_FOUND", "Outbox message not found");
  }

  // Honour send_after — sleep until the scheduled time before sending.
  const sendAfterMs = new Date(row.send_after).getTime() - Date.now();
  if (sendAfterMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, sendAfterMs));
  }

  await markOutboxSending(db, row.id);

  try {
    const payload = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
    const partials = await loadEmailPartials(db);
    const layoutHtml = await loadEmailLayout(db);
    const dataWithPartials = { ...payload, _partials: partials };
    const bodyOverride = typeof payload.__adminCampaignBodyContent === "string" && payload.__adminCampaignBodyContent
      ? payload.__adminCampaignBodyContent
      : null;

    let templateVersion = 0;
    let subject: string;
    let contentWithCustom: string;
    let resolvedContentType: "markdown" | "html" | "text" = "markdown";

    if (bodyOverride) {
      // Direct body still supports subject placeholders like {{eventName}}.
      subject = renderSubject(row.subject, row.subject ?? "PKI Consortium Update", dataWithPartials);
      contentWithCustom = bodyOverride;
      resolvedContentType = "markdown";
    } else {
      const template = await resolveTemplate(db, row.template_key);
      templateVersion = template.version;
      resolvedContentType = template.contentType as "markdown" | "html" | "text";
      const customText = typeof payload.__adminCampaignCustomText === "string"
        ? payload.__adminCampaignCustomText
        : null;
      contentWithCustom = applyCampaignCustomText(template.content, resolvedContentType, customText);
      subject = renderSubject(template.subjectTemplate, row.subject ?? "PKI Consortium Update", dataWithPartials);
    }
    const rendered = await renderEmail(contentWithCustom, dataWithPartials, layoutHtml, resolvedContentType, resolveAppBaseUrl(env));

    let attachments: Array<{ filename: string; contentType: string; base64Content: string }> | undefined;
    const calendar = payload.__calendarInvite as CalendarPayload | undefined;
    if (calendar) {
      attachments = [
        {
          filename: "event.ics",
          contentType: "text/calendar",
          base64Content: btoa(
            Array.from(new TextEncoder().encode(calendar.icsContent), (b) =>
              String.fromCharCode(b)
            ).join("")
          ),
        },
      ];
    }

    // Attach badge to email. prerenderAndCache stores a JPEG at og-badges/{code}
    // (same 1200×630 as the OG image, JPEG q85 — ~80–90 % smaller than PNG).
    // In local dev (no IMAGES binding) it may fall back to PNG — we read the
    // content-type from the R2 object's httpMetadata to use the correct extension.
    const badgeCode = payload.__badgeCode as string | undefined;
    if (badgeCode && env.ASSETS_BUCKET) {
      try {
        const firstName = (payload.firstName as string | undefined) ?? "";
        const lastName  = (payload.lastName  as string | undefined) ?? "";
        const namePart  = [firstName, lastName].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        const badgeObj = await env.ASSETS_BUCKET.get(`og-badges/${badgeCode}`);
        if (badgeObj) {
          const contentType   = badgeObj.httpMetadata?.contentType ?? "image/jpeg";
          const ext           = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
          const buf           = await badgeObj.arrayBuffer();
          const base64        = btoa(Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join(""));
          const baseName      = namePart ? `attendee-badge-${namePart}` : "attendee-badge";
          const badgeFilename = `${baseName}.${ext}`;
          attachments = [
            ...(attachments ?? []),
            { filename: badgeFilename, contentType, base64Content: base64 },
          ];
        }
      } catch {
        // Badge not yet rendered — send email without attachment (non-fatal)
      }
    }

    const bccRecipients = Array.isArray(payload.__bccRecipients)
      ? payload.__bccRecipients.filter((item): item is string => typeof item === "string" && item.includes("@"))
      : undefined;

    const messageId = await sendViaSendgrid(env, {
      to: row.recipient_email,
      bcc: bccRecipients,
      subject,
      html: rendered.html,
      text: rendered.text,
      categories: [row.template_key, row.message_type],
      attachments,
    });

    await markOutboxSent(db, row, messageId, templateVersion);
  } catch (error) {
    await markOutboxFailed(db, row, error);
    throw error;
  }
}

export async function processOutboxByIdBackground(
  db: DatabaseLike,
  env: Env,
  outboxId: string,
): Promise<void> {
  try {
    await processOutboxById(db, env, outboxId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown background email error";
    const details = error instanceof AppError ? error.details : undefined;
    logError("EMAIL_OUTBOX_PROCESS_FAILED", { outboxId, error: message, ...(details ? { details } : {}) });
  }
}

export async function processPendingOutbox(
  db: DatabaseLike,
  env: Env,
  limit = 20,
): Promise<{ processed: number; failed: number }> {
  const rows = await all<OutboxRow>(
    db,
    `SELECT * FROM email_outbox
     WHERE status IN ('queued', 'retrying') AND send_after <= ?
     ORDER BY created_at ASC
     LIMIT ?`,
    [nowIso(), limit],
  );

  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    processed += 1;
    try {
      await processOutboxById(db, env, row.id);
    } catch {
      failed += 1;
    }
  }

  return { processed, failed };
}

export async function summarizePendingOutbox(
  db: DatabaseLike,
): Promise<{ dueNow: number; dueByStatus: Record<string, number>; nextSendAfter: string | null }> {
  const rows = await all<{ status: string; count: number }>(
    db,
    `SELECT status, COUNT(*) AS count
     FROM email_outbox
     WHERE status IN ('queued', 'retrying') AND send_after <= ?
     GROUP BY status`,
    [nowIso()],
  );

  const nextRow = await first<{ send_after: string | null }>(
    db,
    `SELECT MIN(send_after) AS send_after
     FROM email_outbox
     WHERE status IN ('queued', 'retrying')`,
    [],
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

  const placeholders = ids.map(() => "?").join(", ");
  const rows = await all<OutboxRow>(
    db,
    `SELECT * FROM email_outbox
     WHERE id IN (${placeholders})
       AND status IN ('queued', 'retrying')
       AND send_after <= ?
     ORDER BY created_at ASC`,
    [...ids, nowIso()],
  );

  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    processed += 1;
    try {
      await processOutboxById(db, env, row.id);
    } catch {
      failed += 1;
    }
  }

  return {
    processed,
    failed,
    skipped: Math.max(0, ids.length - rows.length),
  };
}

export async function processPendingOutboxBackground(
  db: DatabaseLike,
  env: Env,
  limit = 20,
): Promise<void> {
  try {
    await processPendingOutbox(db, env, limit);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown background outbox batch error";
    logError("EMAIL_OUTBOX_BATCH_FAILED", { limit, error: message });
  }
}

/**
 * Resets failed outbox records back to 'retrying' so they can be picked up
 * by processPendingOutbox on the next retry cycle.
 *
 * @param db    - D1 database binding
 * @param ids   - Optional list of outbox IDs to reset. If omitted, resets ALL failed rows.
 * @returns     - Number of rows reset.
 */
export async function resetFailedOutbox(
  db: DatabaseLike,
  ids?: string[],
): Promise<{ reset: number }> {
  const now = nowIso();
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    const result = await run(
      db,
      `UPDATE email_outbox
       SET status = 'retrying', attempts = 0, send_after = ?, updated_at = ?
       WHERE status = 'failed' AND id IN (${placeholders})`,
      [now, now, ...ids],
    );
    return { reset: result.changes };
  }

  const result = await run(
    db,
    `UPDATE email_outbox
     SET status = 'retrying', attempts = 0, send_after = ?, updated_at = ?
     WHERE status = 'failed'`,
    [now, now],
  );
  return { reset: result.changes };
}
