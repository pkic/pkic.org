import type { Env } from "../types";
import PostalMime from "postal-mime";
import { getRsvpInboundEmailMaxBytes } from "../config";
import { AppError } from "../errors";
import { logError, logInfo } from "../logging";
import { verifySignedRsvpAddressFull } from "../email/rsvp";
import { parseCalendarRsvp, recordCalendarRsvpEvent } from "./calendar-rsvp";

export type IncomingRsvpEmail = Pick<ForwardableEmailMessage, "from" | "to" | "raw" | "rawSize">;

export async function processIncomingEmail(message: IncomingRsvpEmail, env: Env): Promise<void> {
  logInfo("EMAIL_RECEIVED", { rawSize: message.rawSize });

  try {
    const maxBytes = getRsvpInboundEmailMaxBytes(env);
    if (!Number.isSafeInteger(message.rawSize) || message.rawSize < 0 || message.rawSize > maxBytes) {
      throw new AppError(413, "EMAIL_TOO_LARGE", `Inbound RSVP email must not exceed ${maxBytes} bytes`);
    }
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parser = new PostalMime();
    const emailData = await parser.parse(rawEmail);

    logInfo("EMAIL_PARSED", {
      messageId: emailData.messageId,
      attachmentsCount: emailData.attachments?.length || 0,
      attachmentTypes: emailData.attachments?.map((a) => a.mimeType).join(", ") || "none",
      hasText: !!emailData.text,
      hasHtml: !!emailData.html,
    });

    if (!env.INTERNAL_SIGNING_SECRET) {
      logInfo("EMAIL_IGNORED_NO_SECRET", { messageId: emailData.messageId });
      return;
    }

    // Check prefix before wasting cycles on crypto/HMAC verification
    const toLower = message.to.toLowerCase();
    const baseRsvpLocal = (env.RSVP_EMAIL || "rsvp@mail.pkic.org").split("@")[0].toLowerCase();

    let rsvpRegistrationId: string | null = null;
    let rsvpDayDate: string | null = null;

    if (toLower.startsWith(baseRsvpLocal + "+")) {
      const verified = await verifySignedRsvpAddressFull(message.to, env.INTERNAL_SIGNING_SECRET, env.RSVP_EMAIL);
      if (verified) {
        rsvpRegistrationId = verified.registrationId;
        rsvpDayDate = verified.dayDate;
      }
    }

    if (!rsvpRegistrationId) {
      logInfo("EMAIL_IGNORED_INVALID_MAC", {
        messageId: emailData.messageId,
      });
      return;
    }

    // Handle RSVP addresses
    const isBounce =
      (emailData.subject &&
        (emailData.subject.toLowerCase().includes("undeliverable") ||
          emailData.subject.toLowerCase().includes("bounce") ||
          emailData.subject.toLowerCase().includes("delivery status") ||
          emailData.subject.toLowerCase().includes("failure notice"))) ||
      message.from.toLowerCase().includes("mailer-daemon");

    if (isBounce) {
      const sourceMessageId = emailData.messageId || `inbound-${Date.now()}`;
      await recordCalendarRsvpEvent(env.DB, {
        registrationId: rsvpRegistrationId,
        icsUid: `bounce-${rsvpRegistrationId}`,
        attendeeEmail: message.from,
        responseStatus: "bounced",
        provider: "cloudflare_email_routing_bounce",
        sourceMessageId,
        rawPayloadJson: JSON.stringify({ subject: String(emailData.subject || "").slice(0, 500) }),
      });

      logInfo("BOUNCE_PROCESSED", { registrationId: rsvpRegistrationId });
      return;
    }

    let icsContent = "";

    // Look for calendar attachments or text/calendar parts
    for (const attachment of emailData.attachments || []) {
      if (attachment.mimeType === "text/calendar" || attachment.mimeType === "application/ics") {
        icsContent =
          typeof attachment.content === "string" ? attachment.content : new TextDecoder().decode(attachment.content);
        break;
      }
    }

    // TNEF (winmail.dat) attachments from Outlook may embed iCalendar data as plain text
    // within the binary blob — scan for BEGIN:VCALENDAR markers
    if (!icsContent) {
      for (const attachment of emailData.attachments || []) {
        if (attachment.mimeType === "application/ms-tnef" || attachment.mimeType === "application/vnd.ms-tnef") {
          const raw =
            typeof attachment.content === "string"
              ? attachment.content
              : new TextDecoder("utf-8", { fatal: false }).decode(attachment.content as Uint8Array);
          const calStart = raw.indexOf("BEGIN:VCALENDAR");
          const calEnd = raw.indexOf("END:VCALENDAR");
          if (calStart !== -1 && calEnd !== -1) {
            icsContent = raw.slice(calStart, calEnd + "END:VCALENDAR".length);
            break;
          }
        }
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
      let implicitStatus: "accepted" | "declined" | "tentative" | null = null;
      if (subjectLower.startsWith("accepted:")) implicitStatus = "accepted";
      else if (subjectLower.startsWith("declined:")) implicitStatus = "declined";
      else if (subjectLower.startsWith("tentative:")) implicitStatus = "tentative";

      if (implicitStatus) {
        const sourceMessageId = emailData.messageId || `inbound-${Date.now()}`;
        await recordCalendarRsvpEvent(env.DB, {
          registrationId: rsvpRegistrationId,
          icsUid: rsvpDayDate ? `${rsvpRegistrationId}-${rsvpDayDate}@pkic.org` : `implicit-${rsvpRegistrationId}`,
          attendeeEmail: message.from,
          responseStatus: implicitStatus,
          provider: "cloudflare_email_routing_subject",
          sourceMessageId,
          rawPayloadJson: JSON.stringify({ subject: String(emailData.subject || "").slice(0, 500) }),
        });

        logInfo("RSVP_PROCESSED_IMPLICIT", { registrationId: rsvpRegistrationId, status: implicitStatus });
        return;
      }

      logInfo("EMAIL_IGNORED_NO_CALENDAR", {
        messageId: emailData.messageId,
      });
      return;
    }

    let parsedRsvp;
    try {
      parsedRsvp = parseCalendarRsvp(icsContent, message.from);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "INVALID_CALENDAR") throw error;
      logInfo("EMAIL_IGNORED_INVALID_CALENDAR", {
        messageId: emailData.messageId,
        partstatFound: false,
      });
      return;
    }

    // Determine the ics_uid to store.  The per-day RSVP address (verified via
    // HMAC) is the cryptographic source of truth for *which day* was replied to.
    // Construct the canonical per-day UID from it so the admin UI can map it to
    // the correct day row, even if Outlook's reply ICS folds/mangles the UID.
    const icsUid = rsvpDayDate
      ? `${rsvpRegistrationId}-${rsvpDayDate}@pkic.org`
      : (parsedRsvp.icsUid ?? `ics-${rsvpRegistrationId}`);

    const sourceMessageId = emailData.messageId || `inbound-${Date.now()}`;
    await recordCalendarRsvpEvent(env.DB, {
      registrationId: rsvpRegistrationId,
      icsUid,
      attendeeEmail: parsedRsvp.attendeeEmail,
      responseStatus: parsedRsvp.responseStatus,
      provider: "cloudflare_email_routing_ics",
      sourceMessageId,
      dedupeByCalendarUid: true,
    });

    logInfo("RSVP_PROCESSED_ICS", { registrationId: rsvpRegistrationId, status: parsedRsvp.responseStatus });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError("EMAIL_PROCESSING_FAILED", { error: errorMsg });
    throw err; // Workers might need this to signal bounce or error but usually we catch to drop it gracefully
    // message.setReject("Failed to parse")
  }
}
