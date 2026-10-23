import type { Email } from "postal-mime";
import { AppError } from "../errors";
import { parseAttendeeEmail } from "./calendar-rsvp-email-identity";

/** RFC 3464 recipient evidence, independent of a server's envelope sender and subject. */
export function parseCalendarRsvpDeliveryReport(email: Email): { failedRecipient: string | null } | null {
  const reports = email.attachments.filter((attachment) => attachment.mimeType === "message/delivery-status");
  const contentType = email.headers.find((header) => header.key === "content-type")?.value ?? "";
  const isDeliveryReport =
    /^multipart\/report\s*;/iu.test(contentType) &&
    /;\s*report-type\s*=\s*"?delivery-status"?(?:\s*;|\s*$)/iu.test(contentType);
  if (!reports.length && !isDeliveryReport) return null;
  if (!isDeliveryReport || !reports.length)
    throw new AppError(400, "RSVP_EMAIL_BOUNCE_INVALID", "A delivery failure requires a delivery-status report.");
  const recipients = new Set<string>();
  for (const report of reports) {
    const text = typeof report.content === "string" ? report.content : new TextDecoder().decode(report.content);
    for (const block of text
      .replace(/\r\n/g, "\n")
      .replace(/\n[ \t]+/g, " ")
      .split(/\n\n+/u)) {
      if (!/^Action:\s*failed\s*$/imu.test(block)) continue;
      if (!/^Status:\s*[45]\.\d{1,3}\.\d{1,3}\s*$/imu.test(block))
        throw new AppError(400, "RSVP_EMAIL_BOUNCE_INVALID", "A delivery failure requires a failure status.");
      const finalRecipient = block.match(/^Final-Recipient:[ \t]*rfc822[ \t]*;[ \t]*(.*)$/imu)?.[1]?.trim();
      if (!finalRecipient)
        throw new AppError(400, "RSVP_EMAIL_BOUNCE_INVALID", "The delivery failure must name its recipient.");
      const originalRecipient = block.match(/^Original-Recipient:[ \t]*rfc822[ \t]*;[ \t]*(.*)$/imu)?.[1]?.trim();
      const recipient = originalRecipient ?? finalRecipient;
      const address = recipient.startsWith("<") && recipient.endsWith(">") ? recipient.slice(1, -1).trim() : recipient;
      recipients.add(parseAttendeeEmail(address));
    }
  }
  if (recipients.size > 1)
    throw new AppError(400, "RSVP_EMAIL_BOUNCE_AMBIGUOUS", "The delivery failure must identify one recipient.");
  // Delayed and successful delivery reports do not change RSVP state.
  return { failedRecipient: recipients.values().next().value ?? null };
}
