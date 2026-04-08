import type { Env } from "../types";
import PostalMime from "postal-mime";
import { logError, logInfo } from "../logging";
import { verifySignedRsvpAddress } from "./rsvp";
import { verifySignedBounceAddress } from "./bounces";

export async function processIncomingEmail(message: any, env: Env): Promise<void> {
  logInfo("EMAIL_RECEIVED", { from: message.from, to: message.to });

  try {
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parser = new PostalMime();
    const emailData = await parser.parse(rawEmail);

    let icsContent = "";
    
    // Look for calendar attachments or text/calendar parts
    for (const attachment of emailData.attachments || []) {
      if (attachment.mimeType === "text/calendar" || attachment.mimeType === "application/ics") {
        icsContent = typeof attachment.content === "string" ? attachment.content : new TextDecoder().decode(attachment.content);
        break;
      }
    }

    // Sometimes it's inline in the alternative parts or HTML as text/calendar
    if (!icsContent && emailData.text) {
      if (emailData.text.includes("BEGIN:VCALENDAR")) {
        icsContent = emailData.text;
      }
    }

    if (!icsContent) {
      // If we don't have a calendar attachment, check if this was sent to an RSVP/bounce address
      if (!env.INTERNAL_SIGNING_SECRET) {
        logInfo("EMAIL_IGNORED_NO_CALENDAR", { messageId: emailData.messageId });
        return;
      }
      
      const bounceRegistrationId = await verifySignedRsvpAddress(message.to, env.INTERNAL_SIGNING_SECRET);
      if (bounceRegistrationId) {
        // Is this a bounce report or undeliverable?
        const isBounce = emailData.subject && (
          emailData.subject.toLowerCase().includes('undeliverable') || 
          emailData.subject.toLowerCase().includes('bounce') ||
          emailData.subject.toLowerCase().includes('delivery status') ||
          emailData.subject.toLowerCase().includes('failure notice')
        ) || message.from.toLowerCase().includes('mailer-daemon');

        if (isBounce) {
           const sourceMessageId = emailData.messageId || `inbound-${Date.now()}`;
           const dedupeKey = `${bounceRegistrationId}#${sourceMessageId}`;

           await env.DB.prepare(
            `INSERT INTO calendar_rsvp_events 
             (id, registration_id, ics_uid, attendee_email, response_status, provider, 
              source_message_id, dedupe_key, received_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
             ON CONFLICT(dedupe_key) DO UPDATE SET 
             response_status = excluded.response_status, updated_at = datetime('now')`
          ).bind(
            crypto.randomUUID(),
            bounceRegistrationId,
            `${bounceRegistrationId}@pkic.org`,
            message.from,
            "declined", // We mark bounces as declined so we know they won't attend
            "cloudflare_email_routing_bounce",
            sourceMessageId,
            dedupeKey
          ).run();

          logInfo("BOUNCE_PROCESSED", { registrationId: bounceRegistrationId, subject: emailData.subject });
          return;
        }
      }

      // Check if it's a generic signed bounce (from the Outbox ID)
      const outboxId = await verifySignedBounceAddress(message.to, env.INTERNAL_SIGNING_SECRET);
      if (outboxId) {
        logInfo("GENERIC_BOUNCE_RECEIVED", { outboxId, subject: emailData.subject });
        
        const subjectLower = emailData.subject?.toLowerCase() || '';
        const isTemporary = subjectLower.includes('delay') || subjectLower.includes('warning') || subjectLower.includes('transient');
        
        if (isTemporary) {
          // Temporary/Soft bounce: The MTA or SendGrid is still retrying it.
          // Don't fail the message, just note the delay.
          await env.DB.prepare(
            `UPDATE email_outbox SET last_error = 'Delivery delayed by MTA', updated_at = datetime('now') WHERE id = ? AND status != 'bounced'`
          ).bind(outboxId).run();
        } else {
          // Hard bounce: permanently undeliverable. 
          // We set status to 'bounced' securely so that our 'resetFailedOutbox' cron doesn't continually retry sending it.
          await env.DB.prepare(
            `UPDATE email_outbox SET status = 'bounced', last_error = 'Hard Bounce Received', updated_at = datetime('now') WHERE id = ?`
          ).bind(outboxId).run();
        }
        
        return;
      }

      logInfo("EMAIL_IGNORED_NO_CALENDAR", { messageId: emailData.messageId });
      return;
    }

    const icsLines = icsContent.split(/\r?\n/).map((line) => line.trim());
    const uidLine = icsLines.find((line) => line.startsWith("UID:"));
    const partstatLine = icsLines.find((line) => line.includes("PARTSTAT="));
    const attendeeLine = icsLines.find((line) => line.startsWith("ATTENDEE"));

    if (!uidLine || !partstatLine) {
      logInfo("EMAIL_IGNORED_INVALID_CALENDAR", { messageId: emailData.messageId });
      return;
    }

    const uid = uidLine.substring(4);
    const partstat = partstatLine.includes("ACCEPTED")
      ? "ACCEPTED"
      : partstatLine.includes("DECLINED")
        ? "DECLINED"
        : "TENTATIVE";
    
    let attendeeEmail = "unknown@example.com";
    if (attendeeLine) {
      const emailMatch = attendeeLine.match(/mailto:(.+?)(?:;|$)/i);
      if (emailMatch) {
         attendeeEmail = emailMatch[1];
      } else {
         attendeeEmail = message.from;
      }
    } else {
      attendeeEmail = message.from;
    }

    // Multi-day events have UID ending with -YYYY-MM-DD
    // Registration IDs are 36-char UUIDs
    const registrationIdMatch = uid.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    
    if (registrationIdMatch) {
      const registrationId = registrationIdMatch[1];
      const sourceMessageId = emailData.messageId || `inbound-${Date.now()}`;
      const dedupeKey = `${registrationId}#${sourceMessageId}`;

      await env.DB.prepare(
        `INSERT INTO calendar_rsvp_events 
         (id, registration_id, ics_uid, attendee_email, response_status, provider, 
          source_message_id, dedupe_key, received_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
         ON CONFLICT(dedupe_key) DO UPDATE SET 
         response_status = excluded.response_status, updated_at = datetime('now')`,
      )
        .bind(
          crypto.randomUUID(),
          registrationId,
          uid,
          attendeeEmail,
          partstat.toLowerCase(),
          "cloudflare_email_routing",
          sourceMessageId,
          dedupeKey,
        )
        .run();
        
      logInfo("RSVP_PROCESSED", { registrationId, status: partstat, uid });
    } else {
      logInfo("EMAIL_IGNORED_NOT_REGISTRATION_UID", { uid, messageId: emailData.messageId });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError("EMAIL_PROCESSING_FAILED", { error: errorMsg });
    throw err; // Workers might need this to signal bounce or error but usually we catch to drop it gracefully
    // message.setReject("Failed to parse") 
  }
}
