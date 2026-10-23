import type { Email } from "postal-mime";
import { AppError } from "../errors";
import { parseAttendeeEmail } from "./calendar-rsvp-email-identity";

/** RFC 3464 recipient evidence, independent of a server's envelope sender and subject. */
export function calendarRsvpBounceRecipient(email: Email): string | null {
  const reports = email.attachments.filter((attachment) => attachment.mimeType === "message/delivery-status");
  if (!reports.length) return null;
  const contentType = email.headers.find((header) => header.key === "content-type")?.value ?? "";
  if (
    !/^multipart\/report\s*;/iu.test(contentType) ||
    !/;\s*report-type\s*=\s*"?delivery-status"?(?:\s*;|\s*$)/iu.test(contentType)
  )
    throw new AppError(400, "RSVP_EMAIL_BOUNCE_INVALID", "A delivery failure requires a delivery-status report.");
  const recipients = new Set<string>();
  for (const report of reports) {
    const text = typeof report.content === "string" ? report.content : new TextDecoder().decode(report.content);
    for (const block of text
      .replace(/\r\n/g, "\n")
      .replace(/\n[ \t]+/g, " ")
      .split(/\n\n+/u)) {
      if (!/^Action:\s*failed\s*$/imu.test(block)) continue;
      if (!/^Status:\s*[45]\.\d{1,3}\.\d{1,3}\s*$/mu.test(block))
        throw new AppError(400, "RSVP_EMAIL_BOUNCE_INVALID", "A delivery failure requires a failure status.");
      const recipient = block.match(/^Final-Recipient:\s*rfc822\s*;\s*(.+)$/imu)?.[1]?.trim();
      if (!recipient)
        throw new AppError(400, "RSVP_EMAIL_BOUNCE_INVALID", "The delivery failure must name its recipient.");
      recipients.add(parseAttendeeEmail(recipient));
    }
  }
  if (recipients.size > 1)
    throw new AppError(400, "RSVP_EMAIL_BOUNCE_AMBIGUOUS", "The delivery failure must identify one recipient.");
  // Delayed and successful delivery reports do not change RSVP state.
  return recipients.values().next().value ?? null;
}
