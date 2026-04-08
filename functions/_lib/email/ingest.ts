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

    logInfo("EMAIL_PARSED", {
      messageId: emailData.messageId,
      subject: emailData.subject,
      attachmentsCount: emailData.attachments?.length || 0,
      attachmentTypes: emailData.attachments?.map(a => a.mimeType).join(', ') || "none",
      hasText: !!emailData.text,
      hasHtml: !!emailData.html
    });

    if (!env.INTERNAL_SIGNING_SECRET) {
      logInfo("EMAIL_IGNORED_NO_SECRET", { messageId: emailData.messageId });
      return;
    }

    // Check prefix before wasting cycles on crypto/HMAC verification
    const toLower = message.to.toLowerCase();
    const baseRsvpLocal = (env.RSVP_EMAIL || "rsvp@mail.pkic.org").split("@")[0].toLowerCase();
    const baseBounceLocal = (env.BOUNCE_EMAIL || "bounces@mail.pkic.org").split("@")[0].toLowerCase();

    let rsvpRegistrationId: string | null = null;
    let outboxId: string | null = null;

    if (toLower.startsWith(baseRsvpLocal + "+")) {
      rsvpRegistrationId = await verifySignedRsvpAddress(message.to, env.INTERNAL_SIGNING_SECRET, env.RSVP_EMAIL);
    } else if (toLower.startsWith(baseBounceLocal + "+")) {
      outboxId = await verifySignedBounceAddress(message.to, env.INTERNAL_SIGNING_SECRET, env.BOUNCE_EMAIL);
    }

    if (!rsvpRegistrationId && !outboxId) {
      logInfo("EMAIL_IGNORED_INVALID_MAC", {
        messageId: emailData.messageId,
        subject: emailData.subject,
        to: message.to
      });
      return;
    }

    // Handle generic bounces
    if (outboxId) {
      logInfo("GENERIC_BOUNCE_RECEIVED", { outboxId, subject: emailData.subject });
      
      const subjectLower = emailData.subject?.toLowerCase() || '';
      const isTemporary = subjectLower.includes('delay') || subjectLower.includes('warning') || subjectLower.includes('transient');
      
      if (isTemporary) {
        await env.DB.prepare(
          `UPDATE email_outbox SET last_error = 'Delivery delayed by MTA', updated_at = datetime('now') WHERE id = ? AND status != 'bounced'`
        ).bind(outboxId).run();
      } else {
        await env.DB.prepare(
          `UPDATE email_outbox SET status = 'bounced', last_error = 'Hard Bounce Received', updated_at = datetime('now') WHERE id = ?`
        ).bind(outboxId).run();
      }
      return;
    }

    // Handle RSVP addresses (rsvpRegistrationId is guaranteed truthy here)
    const isBounce = emailData.subject && (
      emailData.subject.toLowerCase().includes('undeliverable') || 
      emailData.subject.toLowerCase().includes('bounce') ||
      emailData.subject.toLowerCase().includes('delivery status') ||
      emailData.subject.toLowerCase().includes('failure notice')
    ) || message.from.toLowerCase().includes('mailer-daemon');

    if (isBounce) {
       const sourceMessageId = emailData.messageId || `inbound-${Date.now()}`;
       const dedupeKey = `${rsvpRegistrationId}#${sourceMessageId}`;

       await env.DB.prepare(
        `INSERT INTO calendar_rsvp_events 
         (id, registration_id, ics_uid, attendee_email, response_status, provider, 
          source_message_id, dedupe_key, received_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
         ON CONFLICT(dedupe_key) DO UPDATE SET 
         response_status = excluded.response_status, updated_at = datetime('now')`
      ).bind(
        crypto.randomUUID(),
        rsvpRegistrationId,
        `bounce-${rsvpRegistrationId}`,
        message.from,
        "bounced", // Specifically categorize bounces so they don't look like intentional declines
        "cloudflare_email_routing_bounce",
        sourceMessageId,
        dedupeKey
      ).run();

      logInfo("BOUNCE_PROCESSED", { registrationId: rsvpRegistrationId, subject: emailData.subject });
      return;
    }

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
      // Fallback implicit parsing for Outlook/Apple Mail that hide the ICS file entirely
      const subjectLower = emailData.subject?.toLowerCase() || "";
      let implicitStatus: string | null = null;
      if (subjectLower.startsWith("accepted:")) implicitStatus = "accepted";
      else if (subjectLower.startsWith("declined:")) implicitStatus = "declined";
      else if (subjectLower.startsWith("tentative:")) implicitStatus = "tentative";

      if (implicitStatus) {
         const sourceMessageId = emailData.messageId || `inbound-${Date.now()}`;
         const dedupeKey = `${rsvpRegistrationId}#${sourceMessageId}`;

         await env.DB.prepare(
          `INSERT INTO calendar_rsvp_events 
           (id, registration_id, ics_uid, attendee_email, response_status, provider, 
            source_message_id, dedupe_key, received_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
           ON CONFLICT(dedupe_key) DO UPDATE SET 
           response_status = excluded.response_status, updated_at = datetime('now')`
        ).bind(
          crypto.randomUUID(),
          rsvpRegistrationId,
          `implicit-${rsvpRegistrationId}`,
          message.from,
          implicitStatus,
          "cloudflare_email_routing_subject",
          sourceMessageId,
          dedupeKey
        ).run();

        logInfo("RSVP_PROCESSED_IMPLICIT", { registrationId: rsvpRegistrationId, status: implicitStatus });
        return;
      }

      logInfo("EMAIL_IGNORED_NO_CALENDAR", { 
        messageId: emailData.messageId,
        subject: emailData.subject,
        from: message.from,
        to: message.to
      });
      return;
    }

    const icsLines = icsContent.split(/\r?\n/).map((line) => line.trim());
    const partstatLine = icsLines.find((line) => line.includes("PARTSTAT="));
    const attendeeLine = icsLines.find((line) => line.startsWith("ATTENDEE"));

    if (!partstatLine) {
      logInfo("EMAIL_IGNORED_INVALID_CALENDAR", { 
        messageId: emailData.messageId,
        subject: emailData.subject,
        partstatFound: false
      });
      return;
    }

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

    const sourceMessageId = emailData.messageId || `inbound-${Date.now()}`;
    const dedupeKey = `${rsvpRegistrationId}#${sourceMessageId}`;

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
        rsvpRegistrationId, // Securely mapped from the HMAC matched address! 
        `ics-${rsvpRegistrationId}`,
        attendeeEmail,
        partstat.toLowerCase(),
        "cloudflare_email_routing_ics",
        sourceMessageId,
        dedupeKey,
      )
      .run();
      
    logInfo("RSVP_PROCESSED_ICS", { registrationId: rsvpRegistrationId, status: partstat });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError("EMAIL_PROCESSING_FAILED", { error: errorMsg });
    throw err; // Workers might need this to signal bounce or error but usually we catch to drop it gracefully
    // message.setReject("Failed to parse") 
  }
}
