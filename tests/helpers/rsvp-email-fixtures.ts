/** Synthetic Outlook reply without an extractable calendar attachment. */
export function tnefRsvpEmail(subject: string, messageId: string): string {
  return [
    "From: Alice <alice@example.com>",
    `Message-ID: <${messageId}>`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="outlook"',
    "",
    "--outlook",
    "Content-Type: text/plain; charset=utf-8",
    "",
    subject,
    "--outlook",
    'Content-Type: application/ms-tnef; name="winmail.dat"',
    "Content-Transfer-Encoding: base64",
    "",
    "c3ludGhldGljLXdpbm1haWwuZGF0",
    "--outlook--",
    "",
  ].join("\r\n");
}

export function deliveryStatusEmail(
  recipient: string | readonly string[] = "alice@example.com",
  action = "failed",
  status = "5.1.1",
): string {
  return [
    "From: Mail Delivery <mailer-daemon@example.test>",
    "Message-ID: <delivery-status@example.test>",
    "Subject: Delivery Status Notification",
    "MIME-Version: 1.0",
    'Content-Type: multipart/report; report-type=delivery-status; boundary="dsn"',
    "",
    "--dsn",
    "Content-Type: text/plain",
    "",
    "Delivery report.",
    "--dsn",
    "Content-Type: message/delivery-status",
    "",
    "Reporting-MTA: dns; example.test",
    "",
    ...(typeof recipient === "string" ? [recipient] : recipient).flatMap((email) => [
      `Final-Recipient: rfc822; ${email}`,
      `Action: ${action}`,
      `Status: ${status}`,
      "",
    ]),
    "--dsn--",
    "",
  ].join("\r\n");
}

export function calendarReplyIcs(registrationId: string, attendee = "alice@example.com"): string {
  return [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    `UID:${registrationId}@pkic.org`,
    `ATTENDEE;PARTSTAT=ACCEPTED:mailto:${attendee}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
